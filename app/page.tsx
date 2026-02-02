'use client'

import { useEffect, useMemo, useState } from 'react'
import { supabase } from '@/lib/supabase'

// --- TYPES ---
type Event = { id: string; name: string; event_date: string }
type Fight = {
  id: string
  event_id: string
  fighter_red: string
  fighter_blue: string
  fight_time: string
}

type FinishType =
  | 'submission'
  | 'knockout'
  | 'decision - unanimous'
  | 'decision - split'
  | 'no contest'

type Pick = {
  winner: 'red' | 'blue'
  round: number | null
  finishType: FinishType
  locked: boolean
}

type EventWithFights = Event & { fights: Fight[] }

// --- HELPERS ---
const isRoundIrrelevant = (finishType: FinishType) =>
  finishType === 'decision - unanimous' ||
  finishType === 'decision - split' ||
  finishType === 'no contest'

// --- AUTH COMPONENT (REAL SUPABASE AUTH) ---
function Auth({ user, setUser }: { user: any; setUser: (user: any) => void }) {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [loading, setLoading] = useState(false)

  // Keep user in sync with Supabase session
  useEffect(() => {
    const init = async () => {
      const { data } = await supabase.auth.getSession()
      setUser(data.session?.user ?? null)
    }

    init()

    const { data: sub } = supabase.auth.onAuthStateChange((_event, session) => {
      setUser(session?.user ?? null)
    })

    return () => {
      sub.subscription.unsubscribe()
    }
  }, [setUser])

  const handleLogin = async () => {
    setLoading(true)
    const { data, error } = await supabase.auth.signInWithPassword({ email, password })
    setLoading(false)

    if (error) return alert(error.message)
    setUser(data.user)
  }

  const handleLogout = async () => {
    setLoading(true)
    const { error } = await supabase.auth.signOut()
    setLoading(false)

    if (error) return alert(error.message)
    setUser(null)
  }

  return (
    <div style={{ marginBottom: 24 }}>
      {user ? (
        <div>
          <p>Logged in as: {user.email}</p>
          <button onClick={handleLogout} style={{ padding: '8px 16px', borderRadius: 8 }}>
            {loading ? '...' : 'Logout'}
          </button>
        </div>
      ) : (
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
          <input
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="email"
            style={{ padding: '8px 10px', borderRadius: 8, border: '1px solid #ccc' }}
          />
          <input
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="password"
            type="password"
            style={{ padding: '8px 10px', borderRadius: 8, border: '1px solid #ccc' }}
          />
          <button
            onClick={handleLogin}
            style={{ padding: '8px 16px', borderRadius: 8 }}
            disabled={loading || !email || !password}
          >
            {loading ? '...' : 'Login'}
          </button>
        </div>
      )}
    </div>
  )
}

// --- MAIN PAGE ---
export default function HomePage() {
  const [user, setUser] = useState<any>(null)
  const [eventsWithFights, setEventsWithFights] = useState<EventWithFights[]>([])
  const [picks, setPicks] = useState<Record<string, Pick>>({})

  const rounds = useMemo(() => [1, 2, 3, 4, 5], [])
  const finishes: FinishType[] = useMemo(
    () => ['submission', 'knockout', 'decision - unanimous', 'decision - split', 'no contest'],
    []
  )

  // --- Fetch events & fights ---
  useEffect(() => {
    const fetchEventsAndFights = async () => {
      const { data: events, error: eventsError } = await supabase
        .from('events')
        .select('*')
        .order('event_date', { ascending: true })

      if (eventsError) console.error('Events fetch error:', eventsError)

      const { data: fights, error: fightsError } = await supabase
        .from('fights')
        .select('*')
        .order('fight_time', { ascending: true })

      if (fightsError) console.error('Fights fetch error:', fightsError)

      if (!events || !fights) return

      const combined: EventWithFights[] = events.map((event) => ({
        ...event,
        fights: fights.filter((fight) => fight.event_id === event.id),
      }))

      setEventsWithFights(combined)
    }

    fetchEventsAndFights()
  }, [])

  // --- Fetch existing picks for user ---
  useEffect(() => {
    const fetchUserPicks = async () => {
      if (!user) {
        setPicks({})
        return
      }

      const { data: existingPicks, error } = await supabase
        .from('picks')
        .select('*')
        .eq('user_id', user.id)

      if (error) {
        console.error('Picks fetch error:', error)
        return
      }

      const pickMap: Record<string, Pick> = {}
      ;(existingPicks || []).forEach((p: any) => {
        pickMap[p.fight_id] = {
          winner: p.winner,
          round: p.round ?? null,
          finishType: p.finish_type,
          locked: p.locked ?? false,
        }
      })

      setPicks(pickMap)
    }

    fetchUserPicks()
  }, [user])

  // --- Update local pick (not saved yet) ---
  const handlePick = (
    fightId: string,
    winner: 'red' | 'blue',
    round: number | null,
    finishType: FinishType
  ) => {
    const roundIrrelevant = isRoundIrrelevant(finishType)

    setPicks((prev) => {
      const existing = prev[fightId]
      const locked = existing?.locked ?? false

      // If locked, do not allow edits
      if (locked) return prev

      return {
        ...prev,
        [fightId]: {
          winner,
          finishType,
          round: roundIrrelevant ? null : round ?? 1,
          locked: false,
        },
      }
    })
  }

  // --- Toggle Lock Pick (DB-backed) ---
  const toggleLockPick = async (fightId: string) => {
    if (!user) return alert('Please login first.')

    const pick = picks[fightId]
    if (!pick) return alert('Pick not set!')

    // Enforce rules matching your DB constraint:
    const roundIrrelevant = isRoundIrrelevant(pick.finishType)
    const roundToSave = roundIrrelevant ? null : pick.round ?? 1

    const newLockedState = !pick.locked

    // Optimistic UI update
    setPicks((prev) => ({
      ...prev,
      [fightId]: { ...prev[fightId], locked: newLockedState, round: roundToSave },
    }))

    if (newLockedState) {
      // Locking => upsert row
      const { error } = await supabase
        .from('picks')
        .upsert(
          {
            fight_id: fightId,
            user_id: user.id,
            winner: pick.winner,
            round: roundToSave,
            finish_type: pick.finishType,
            locked: true,
          },
          { onConflict: 'fight_id,user_id' }
        )

      if (error) {
        console.error('Pick save error:', error)

        alert(
          error.message === 'Picks are locked: fight already started'
            ? 'This fight has already started. Picks are locked.'
            : 'Unable to lock pick.'
        )

        // revert optimistic UI
        setPicks((prev) => ({
          ...prev,
          [fightId]: { ...prev[fightId], locked: false },
        }))
      }
    } else {
      // Unlocking => update locked=false (keep row in DB)
      const { error } = await supabase
        .from('picks')
        .update({ locked: false })
        .eq('fight_id', fightId)
        .eq('user_id', user.id)

      if (error) {
        console.error('Pick unlock error:', error)

        alert(
          error.message === 'Picks are locked: fight already started'
            ? 'This fight has already started. Picks cannot be changed.'
            : 'Unable to unlock pick.'
        )

        // revert optimistic UI
        setPicks((prev) => ({
          ...prev,
          [fightId]: { ...prev[fightId], locked: true },
        }))
      }
    }
  }

  const lockedCount = user ? Object.values(picks).filter((p) => p.locked).length : 0

  return (
    <main
      style={{
        padding: 20,
        maxWidth: 900,
        margin: '0 auto',
        fontFamily: 'system-ui, sans-serif',
        backgroundColor: '#f0f2f5',
        minHeight: '100vh',
        color: '#111',
      }}
    >
      <h1 style={{ textAlign: 'center', marginBottom: 36 }}>FightPicks</h1>

      {/* Total Locked Picks */}
      {user && (
        <p style={{ marginBottom: 16, fontWeight: 600 }}>
          You’ve locked {lockedCount} {lockedCount === 1 ? 'pick' : 'picks'}
        </p>
      )}

      {/* Auth */}
      <Auth user={user} setUser={setUser} />

      {/* Events & Fights */}
      {eventsWithFights.map((event) => (
        <div
          key={event.id}
          style={{
            background: '#fff',
            borderRadius: 16,
            padding: 24,
            marginBottom: 28,
            boxShadow: '0 8px 20px rgba(0,0,0,0.12)',
          }}
        >
          <h2 style={{ marginBottom: 6 }}>{event.name}</h2>
          <p style={{ marginBottom: 20, fontWeight: 500 }}>
            {new Date(event.event_date).toLocaleDateString()}
          </p>

          {event.fights.length > 0 ? (
            event.fights.map((fight) => {
              const fightTime = new Date(fight.fight_time).getTime()
              const now = new Date().getTime()
              const fightStarted = now >= fightTime

              const pick = picks[fight.id]
              const finishType: FinishType = pick?.finishType ?? 'submission'
              const roundIrrelevant = isRoundIrrelevant(finishType)

              const isLocked = pick?.locked ?? false
              const inputsDisabled = fightStarted || isLocked

              return (
                <div
                  key={fight.id}
                  style={{
                    background: '#eef1f4',
                    borderRadius: 12,
                    padding: 16,
                    marginBottom: 16,
                    opacity: fightStarted ? 0.6 : 1,
                  }}
                >
                  {/* Fight header */}
                  <div
                    style={{
                      display: 'flex',
                      justifyContent: 'space-between',
                      alignItems: 'center',
                      marginBottom: 10,
                      fontWeight: 700,
                    }}
                  >
                    <span style={{ color: '#b91c1c' }}>{fight.fighter_red}</span>
                    <span>vs</span>
                    <span style={{ color: '#1d4ed8' }}>{fight.fighter_blue}</span>
                  </div>

                  {/* Fight time */}
                  <div style={{ fontSize: 14, fontWeight: 500, marginBottom: 6 }}>
                    {new Date(fight.fight_time).toLocaleTimeString([], {
                      hour: 'numeric',
                      minute: '2-digit',
                    })}
                  </div>
                  <div
                    style={{
                      marginBottom: 12,
                      fontSize: 12,
                      fontWeight: 500,
                      color: fightStarted ? '#777' : '#333',
                    }}
                  >
                    {fightStarted ? 'Fight started' : 'Upcoming'}
                  </div>

                  {/* Winner buttons */}
                  <div style={{ display: 'flex', gap: 12, marginBottom: 12 }}>
                    <button
                      onClick={() =>
                        handlePick(
                          fight.id,
                          'red',
                          pick?.round ?? 1,
                          pick?.finishType ?? 'submission'
                        )
                      }
                      disabled={inputsDisabled}
                      style={{
                        flex: 1,
                        padding: '10px 0',
                        borderRadius: 8,
                        border: 'none',
                        background: pick?.winner === 'red' ? '#dc2626' : '#f87171',
                        color: '#fff',
                        fontWeight: 700,
                        cursor: inputsDisabled ? 'not-allowed' : 'pointer',
                      }}
                    >
                      Pick Red
                    </button>
                    <button
                      onClick={() =>
                        handlePick(
                          fight.id,
                          'blue',
                          pick?.round ?? 1,
                          pick?.finishType ?? 'submission'
                        )
                      }
                      disabled={inputsDisabled}
                      style={{
                        flex: 1,
                        padding: '10px 0',
                        borderRadius: 8,
                        border: 'none',
                        background: pick?.winner === 'blue' ? '#2563eb' : '#60a5fa',
                        color: '#fff',
                        fontWeight: 700,
                        cursor: inputsDisabled ? 'not-allowed' : 'pointer',
                      }}
                    >
                      Pick Blue
                    </button>
                  </div>

                  {/* Lock / Unlock */}
                  {pick && (
                    <button
                      onClick={() => toggleLockPick(fight.id)}
                      disabled={fightStarted}
                      style={{
                        padding: '8px 16px',
                        borderRadius: 8,
                        background: pick.locked ? '#f87171' : '#4ade80',
                        border: 'none',
                        fontWeight: 700,
                        cursor: fightStarted ? 'not-allowed' : 'pointer',
                        marginBottom: 12,
                      }}
                    >
                      {pick.locked ? 'Unlock Pick' : 'Lock Pick'}
                    </button>
                  )}

                  {/* Round buttons */}
                  <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
                    {rounds.map((r) => (
                      <button
                        key={r}
                        onClick={() => {
                          const currentWinner = pick?.winner
                          const currentFinish = pick?.finishType ?? 'submission'
                          if (!currentWinner) return alert('Pick a winner first.')
                          handlePick(fight.id, currentWinner, r, currentFinish)
                        }}
                        disabled={inputsDisabled || roundIrrelevant}
                        style={{
                          padding: '6px 12px',
                          borderRadius: 6,
                          border: pick?.round === r ? '2px solid #111' : '1px solid #ccc',
                          background: pick?.round === r ? '#facc15' : '#fff',
                          cursor: inputsDisabled || roundIrrelevant ? 'not-allowed' : 'pointer',
                        }}
                      >
                        {r}
                      </button>
                    ))}
                  </div>

                  {roundIrrelevant && (
                    <p style={{ fontSize: 12, color: '#777', marginBottom: 8 }}>
                      Round is irrelevant for {finishType}
                    </p>
                  )}

                  {/* Finish type buttons */}
                  <div style={{ display: 'flex', gap: 8, marginBottom: 12, flexWrap: 'wrap' }}>
                    {finishes.map((f) => (
                      <button
                        key={f}
                        onClick={() => {
                          const currentWinner = pick?.winner
                          if (!currentWinner) return alert('Pick a winner first.')
                          handlePick(fight.id, currentWinner, pick?.round ?? 1, f)
                        }}
                        disabled={inputsDisabled}
                        style={{
                          padding: '6px 12px',
                          borderRadius: 6,
                          border: pick?.finishType === f ? '2px solid #111' : '1px solid #ccc',
                          background: pick?.finishType === f ? '#34d399' : '#fff',
                          cursor: inputsDisabled ? 'not-allowed' : 'pointer',
                        }}
                      >
                        {f}
                      </button>
                    ))}
                  </div>

                  {/* Selected pick */}
                  {pick && (
                    <p
                      style={{
                        marginTop: 8,
                        fontWeight: 700,
                        textTransform: 'uppercase',
                        color: pick.winner === 'red' ? '#b91c1c' : '#1d4ed8',
                      }}
                    >
                      Your Pick: {pick.winner} | {roundIrrelevant ? 'N/A' : `Round ${pick.round}`}{' '}
                      | {pick.finishType} {pick.locked ? '(Locked)' : '(Unlocked)'}
                    </p>
                  )}
                </div>
              )
            })
          ) : (
            <p>No fights scheduled</p>
          )}
        </div>
      ))}
    </main>
  )
}


