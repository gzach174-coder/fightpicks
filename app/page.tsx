
'use client'

import { useEffect, useMemo, useState } from 'react'
import { supabase } from '@/lib/supabase'

// --- TYPES ---
type Event = {
  id: string
  name: string
  event_date: string
  lock_time: string | null
  results_open: boolean
}
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
  confidence: number // 1-10
  locked: boolean
}

type EventWithFights = Event & { fights: Fight[] }

type Profile = { id: string; username: string; is_admin?: boolean }

type AdminResult = {
  winner: 'red' | 'blue' | null
  finishType: FinishType | null
  round: number | null
}

type LeaderRow = {
  event_id: string
  user_id: string
  username: string | null
  total_score: number | null
  scored_picks: number | null
  perfect_picks: number | null
  total_confidence_used: number | null
}

// --- HELPERS ---
const isRoundIrrelevant = (finishType: FinishType) =>
  finishType === 'decision - unanimous' ||
  finishType === 'decision - split' ||
  finishType === 'no contest'

const clampConfidence = (n: number) => Math.max(1, Math.min(10, n))
const isValidUsername = (u: string) => /^[a-zA-Z0-9_]{3,20}$/.test(u)

// --- Error message helper ---
const getErrorMessage = (error: any): string => {
  if (!error) return 'Unknown error'
  const parts = [error.message, error.details, error.hint, error.code].filter(Boolean)
  return parts.length > 0 ? parts.join(' | ') : 'Unknown error'
}

// --- AUTH COMPONENT (REAL SUPABASE AUTH) ---
function Auth({ user, setUser }: { user: any; setUser: (user: any) => void }) {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [loading, setLoading] = useState(false)

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
    <div style={{ marginBottom: 20 }}>
      {user ? (
        <div>
          <p style={{ margin: 0, marginBottom: 10 }}>Logged in as: {user.email}</p>
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
            style={{
              padding: '8px 10px',
              borderRadius: 8,
              border: '1px solid #ccc',
              minWidth: 220,
              flex: '1 1 220px',
            }}
          />
          <input
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="password"
            type="password"
            style={{
              padding: '8px 10px',
              borderRadius: 8,
              border: '1px solid #ccc',
              minWidth: 220,
              flex: '1 1 220px',
            }}
          />
          <button
            onClick={handleLogin}
            style={{ padding: '8px 16px', borderRadius: 8, flex: '0 0 auto' }}
            disabled={loading || !email || !password}
          >
            {loading ? '...' : 'Login'}
          </button>
        </div>
      )}
    </div>
  )
}

export default function HomePage() {
  const [user, setUser] = useState<any>(null)

  const [eventsWithFights, setEventsWithFights] = useState<EventWithFights[]>([])
  const [picks, setPicks] = useState<Record<string, Pick>>({})

  const [profile, setProfile] = useState<Profile | null>(null)
  const [isAdmin, setIsAdmin] = useState(false)
  const [usernameInput, setUsernameInput] = useState('')
  const [savingUsername, setSavingUsername] = useState(false)
  const [fightResults, setFightResults] = useState<Record<string, AdminResult>>({})
  const [resultsLocked, setResultsLocked] = useState<Record<string, boolean>>({})

  const [leaderboards, setLeaderboards] = useState<Record<string, LeaderRow[]>>({})
  const [loadingEvents, setLoadingEvents] = useState(false)
  const [loadingPicks, setLoadingPicks] = useState(false)
  const [loadingLeaderboards, setLoadingLeaderboards] = useState(false)

  const rounds = useMemo(() => [1, 2, 3, 4, 5], [])
  const finishes: FinishType[] = useMemo(
    () => ['submission', 'knockout', 'decision - unanimous', 'decision - split', 'no contest'],
    []
  )

  // --- Fetch events & fights ---
  useEffect(() => {
    const fetchEventsAndFights = async () => {
      setLoadingEvents(true)

      const { data: events, error: eventsError } = await supabase
        .from('events')
        .select('id, name, event_date, lock_time, results_open')
        .order('event_date', { ascending: true })

      if (eventsError) console.error('Events fetch error:', eventsError)

      const { data: fights, error: fightsError } = await supabase
        .from('fights')
        .select('*')
        .order('fight_time', { ascending: true })

      if (fightsError) console.error('Fights fetch error:', fightsError)

      setLoadingEvents(false)

      if (!events || !fights) return

      const combined: EventWithFights[] = events.map((event) => ({
        ...event,
        fights: fights.filter((fight) => fight.event_id === event.id),
      }))

      setEventsWithFights(combined)
    }

    fetchEventsAndFights()
  }, [])

  // --- Fetch profile when user logs in ---
  useEffect(() => {
    const fetchProfile = async () => {
      if (!user) {
        setProfile(null)
        setUsernameInput('')
        setIsAdmin(false)
        return
      }

      const { data, error } = await supabase
        .from('profiles')
        .select('id, username, is_admin')
        .eq('id', user.id)
        .single()

      if (error) {
        console.error('Profile fetch error:', error)
        return
      }

      setProfile(data)
      setUsernameInput(data?.username ?? '')
      setIsAdmin(data?.is_admin ?? false)
    }

    fetchProfile()
  }, [user])

  // --- Fetch existing picks for user ---
  useEffect(() => {
    const fetchUserPicks = async () => {
      if (!user) {
        setPicks({})
        return
      }

      setLoadingPicks(true)

      const { data: existingPicks, error } = await supabase
        .from('picks')
        .select('*')
        .eq('user_id', user.id)

      setLoadingPicks(false)

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
          confidence: clampConfidence(p.confidence ?? 5),
          locked: p.locked ?? false,
        }
      })

      setPicks(pickMap)
    }

    fetchUserPicks()
  }, [user])

  // --- Fetch leaderboards PER EVENT (filtered) ---
  const fetchLeaderboards = async () => {
    if (eventsWithFights.length === 0) return

    setLoadingLeaderboards(true)

    const map: Record<string, LeaderRow[]> = {}

    // Fetch each event leaderboard separately (simple + clear)
    for (const event of eventsWithFights) {
      const { data, error } = await supabase
        .from('event_leaderboard')
        .select('*')
        .eq('event_id', event.id)
        .order('total_score', { ascending: false })

      if (error) {
        console.error('Leaderboard fetch error:', error)
        continue
      }

      map[event.id] = (data || []) as LeaderRow[]
    }

    setLeaderboards(map)
    setLoadingLeaderboards(false)
  }

  useEffect(() => {
    fetchLeaderboards()
  }, [eventsWithFights])

  // --- Username update ---
  const saveUsername = async () => {
    if (!user) return alert('Please login first.')

    const desired = usernameInput.trim()

    if (!isValidUsername(desired)) {
      return alert('Username must be 3-20 chars and only letters, numbers, underscore.')
    }

    setSavingUsername(true)

    const { error } = await supabase.from('profiles').update({ username: desired }).eq('id', user.id)

    setSavingUsername(false)

    if (error) {
      console.error('Username update error:', error)

      if ((error as any).code === '23505' || (error.message || '').toLowerCase().includes('duplicate')) {
        return alert('That username is already taken. Try another.')
      }

      return alert('Could not update username. Check console.')
    }

    setProfile((prev) => (prev ? { ...prev, username: desired } : prev))
    alert('Username updated!')
  }

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
      if (locked) return prev

      return {
        ...prev,
        [fightId]: {
          winner,
          finishType,
          round: roundIrrelevant ? null : round ?? 1,
          confidence: clampConfidence(existing?.confidence ?? 5),
          locked: false,
        },
      }
    })
  }

  // --- Update confidence locally ---
  const handleConfidence = (fightId: string, confidence: number) => {
    setPicks((prev) => {
      const existing = prev[fightId]
      if (!existing) return prev
      if (existing.locked) return prev
      return { ...prev, [fightId]: { ...existing, confidence: clampConfidence(confidence) } }
    })
  }

  // --- Toggle Lock Pick ---
  const toggleLockPick = async (fightId: string) => {
    if (!user) return alert('Please login first.')

    const pick = picks[fightId]
    if (!pick) return alert('Pick not set!')

    const roundIrrelevant = isRoundIrrelevant(pick.finishType)
    const roundToSave = roundIrrelevant ? null : pick.round ?? 1

    const newLockedState = !pick.locked

    // Optimistic UI update
    setPicks((prev) => ({
      ...prev,
      [fightId]: { ...prev[fightId], locked: newLockedState, round: roundToSave },
    }))

    if (newLockedState) {
      const { error } = await supabase
        .from('picks')
        .upsert(
          {
            fight_id: fightId,
            user_id: user.id,
            winner: pick.winner,
            round: roundToSave,
            finish_type: pick.finishType,
            confidence: clampConfidence(pick.confidence ?? 5),
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

        setPicks((prev) => ({
          ...prev,
          [fightId]: { ...prev[fightId], locked: false },
        }))
      }
    } else {
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

        setPicks((prev) => ({
          ...prev,
          [fightId]: { ...prev[fightId], locked: true },
        }))
      }
    }
  }

  // --- Admin: Save fight result ---
  const handleAdminSaveResult = async (fightId: string) => {
    if (!isAdmin) return alert('Not authorized.')
    
    const result = fightResults[fightId]
    if (!result || !result.winner || !result.finishType) {
      return alert('Please select winner and finish type.')
    }
    // Determine round: null for finishes where round is irrelevant
    const roundToSave: number | null = isRoundIrrelevant(result.finishType)
      ? null
      : result.round ?? 1

    const res = await supabase.rpc('admin_set_fight_result', {
      p_fight_id: fightId,
      p_actual_winner: result.winner,
      p_actual_finish_type: result.finishType,
      p_actual_round: roundToSave,
    })

    // RPC returns void, so res.data is always null on success
    // Success is determined ONLY by res.error being null
    if (res?.error) {
      const e = res.error
      const msg = [e?.message, e?.details, e?.hint, e?.code].filter(Boolean).join(' | ') || String(e)
      alert(msg)
      return
    }

    // res.error is null -> success (even though res.data is null)
    alert('Result saved!')

    // Re-fetch fights and events
    const { data: events, error: eventsError } = await supabase
      .from('events')
      .select('id, name, event_date, lock_time, results_open')
      .order('event_date', { ascending: true })

    const { data: fights, error: fightsError } = await supabase
      .from('fights')
      .select('*')
      .order('fight_time', { ascending: true })

    if (!events || !fights || eventsError || fightsError) {
      console.error('Re-fetch error:', eventsError || fightsError)
      return
    }

    const combined: EventWithFights[] = events.map((event) => ({
      ...event,
      fights: fights.filter((fight) => fight.event_id === event.id),
    }))

    setEventsWithFights(combined)

    // Re-fetch leaderboards after results saved
    await fetchLeaderboards()
  }

  // --- Admin: Lock results ---
  const handleAdminLockResults = async (fightId: string) => {
    if (!isAdmin) return alert('Not authorized.')

    const { error } = await supabase.rpc('admin_set_results_locked', {
      p_fight_id: fightId,
      p_locked: true,
    })

    if (error) {
      console.error('Admin lock error:', { data: null, error })
      return alert(getErrorMessage(error))
    }

    alert('Results locked!')
    setResultsLocked((prev) => ({ ...prev, [fightId]: true }))

    // Re-fetch fights
    const { data: events, error: eventsError } = await supabase
      .from('events')
      .select('id, name, event_date, lock_time, results_open')
      .order('event_date', { ascending: true })

    const { data: fights, error: fightsError } = await supabase
      .from('fights')
      .select('*')
      .order('fight_time', { ascending: true })

    if (!events || !fights || eventsError || fightsError) {
      console.error('Re-fetch error:', eventsError || fightsError)
      return
    }

    const combined: EventWithFights[] = events.map((event) => ({
      ...event,
      fights: fights.filter((fight) => fight.event_id === event.id),
    }))

    setEventsWithFights(combined)

    // Re-fetch leaderboards after locking results
    await fetchLeaderboards()
  }

  // --- Admin: Unlock results ---
  const handleAdminUnlockResults = async (fightId: string) => {
    if (!isAdmin) return alert('Not authorized.')

    const { error } = await supabase.rpc('admin_set_results_locked', {
      p_fight_id: fightId,
      p_locked: false,
    })

    if (error) {
      console.error('Admin unlock error:', { data: null, error })
      return alert(getErrorMessage(error))
    }

    alert('Results unlocked!')
    setResultsLocked((prev) => ({ ...prev, [fightId]: false }))

    // Re-fetch fights
    const { data: events, error: eventsError } = await supabase
      .from('events')
      .select('id, name, event_date, lock_time, results_open')
      .order('event_date', { ascending: true })

    const { data: fights, error: fightsError } = await supabase
      .from('fights')
      .select('*')
      .order('fight_time', { ascending: true })

    if (!events || !fights || eventsError || fightsError) {
      console.error('Re-fetch error:', eventsError || fightsError)
      return
    }

    const combined: EventWithFights[] = events.map((event) => ({
      ...event,
      fights: fights.filter((fight) => fight.event_id === event.id),
    }))

    setEventsWithFights(combined)

    // Re-fetch leaderboards after unlocking results
    await fetchLeaderboards()
  }

  // --- Admin: Toggle event results open/closed ---
  const handleAdminToggleEventResults = async (eventId: string, open: boolean) => {
    if (!isAdmin) return alert('Not authorized.')

    const { error } = await supabase.rpc('admin_set_event_results_open', {
      p_event_id: eventId,
      p_open: open,
    })

    if (error) {
      console.error('Admin toggle results error:', error)
      return alert(error.message || 'Unable to toggle results.')
    }

    alert(open ? 'Results opened!' : 'Results closed!')

    // Re-fetch events
    const { data: events, error: eventsError } = await supabase
      .from('events')
      .select('id, name, event_date, lock_time, results_open')
      .order('event_date', { ascending: true })

    const { data: fights, error: fightsError } = await supabase
      .from('fights')
      .select('*')
      .order('fight_time', { ascending: true })

    if (!events || !fights || eventsError || fightsError) {
      console.error('Re-fetch error:', eventsError || fightsError)
      return
    }

    const combined: EventWithFights[] = events.map((event) => ({
      ...event,
      fights: fights.filter((fight) => fight.event_id === event.id),
    }))

    setEventsWithFights(combined)

    // Re-fetch leaderboards after toggling results
    await fetchLeaderboards()
  }

  const lockedCount = user ? Object.values(picks).filter((p) => p.locked).length : 0

  return (
    <main
      style={{
        padding: 12,
        maxWidth: 900,
        margin: '0 auto',
        fontFamily: 'system-ui, sans-serif',
        backgroundColor: '#f0f2f5',
        minHeight: '100vh',
        color: '#111',
      }}
    >
      <h1 style={{ textAlign: 'center', marginBottom: 14 }}>FightPicks</h1>

      <div style={{ marginBottom: 14, fontSize: 13, color: '#333' }}>
        <div>
          Events loaded: <b>{eventsWithFights.length}</b> {loadingEvents ? '(loading...)' : ''}
        </div>
        {user && (
          <div>
            Picks loaded: <b>{Object.keys(picks).length}</b> {loadingPicks ? '(loading...)' : ''}{' '}
            | Locked: <b>{lockedCount}</b>
          </div>
        )}
        <div>
          Leaderboards: {loadingLeaderboards ? <b>loading...</b> : <b>ready</b>}
        </div>
      </div>

      <Auth user={user} setUser={setUser} />

      {/* Username */}
      {user && (
        <div
          style={{
            background: '#fff',
            borderRadius: 16,
            padding: 16,
            marginBottom: 18,
            boxShadow: '0 8px 20px rgba(0,0,0,0.12)',
          }}
        >
          <h2 style={{ margin: 0, marginBottom: 10, fontSize: 18 }}>Your Username</h2>
          <div style={{ fontSize: 13, color: '#444', marginBottom: 10 }}>
            Public on leaderboards. 3–20 chars, letters/numbers/underscore.
          </div>
          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
            <input
              value={usernameInput}
              onChange={(e) => setUsernameInput(e.target.value)}
              placeholder="username"
              style={{
                padding: '8px 10px',
                borderRadius: 8,
                border: '1px solid #ccc',
                minWidth: 240,
                flex: '1 1 240px',
              }}
            />
            <button
              onClick={saveUsername}
              disabled={savingUsername}
              style={{ padding: '8px 16px', borderRadius: 8, fontWeight: 700 }}
            >
              {savingUsername ? 'Saving...' : 'Save Username'}
            </button>
          </div>

          {profile?.username && (
            <div style={{ marginTop: 10, fontSize: 13 }}>
              Current: <b>{profile.username}</b>
            </div>
          )}
        </div>
      )}

      {/* Events */}
      {eventsWithFights.map((event) => {
        const rows = leaderboards[event.id] || []
        const meIndex = user ? rows.findIndex((r) => r.user_id === user.id) : -1
        const myRow = meIndex >= 0 ? rows[meIndex] : null

        // Calculate if event is locked
        const isEventLocked = event.lock_time ? Date.now() >= new Date(event.lock_time).getTime() : false

        return (
          <div
            key={event.id}
            style={{
              background: '#fff',
              borderRadius: 16,
              padding: 16,
              marginBottom: 18,
              boxShadow: '0 8px 20px rgba(0,0,0,0.12)',
            }}
          >
            <h2 style={{ marginBottom: 6, fontSize: 18 }}>{event.name}</h2>
            <p style={{ marginBottom: 10, fontWeight: 500 }}>
              {new Date(event.event_date).toLocaleDateString()}
            </p>

            {/* Admin Event Controls */}
            {isAdmin && (
              <div style={{ marginBottom: 12, display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                <button
                  onClick={() => handleAdminToggleEventResults(event.id, true)}
                  disabled={event.results_open}
                  style={{
                    padding: '6px 12px',
                    borderRadius: 6,
                    background: event.results_open ? '#d1d5db' : '#10b981',
                    color: '#fff',
                    border: 'none',
                    fontWeight: 600,
                    fontSize: 12,
                    cursor: event.results_open ? 'not-allowed' : 'pointer',
                  }}
                >
                  Open Results
                </button>
                <button
                  onClick={() => handleAdminToggleEventResults(event.id, false)}
                  disabled={!event.results_open}
                  style={{
                    padding: '6px 12px',
                    borderRadius: 6,
                    background: !event.results_open ? '#d1d5db' : '#ef4444',
                    color: '#fff',
                    border: 'none',
                    fontWeight: 600,
                    fontSize: 12,
                    cursor: !event.results_open ? 'not-allowed' : 'pointer',
                  }}
                >
                  Close Results
                </button>
              </div>
            )}

            {/* My rank */}
            {user && (
              <div style={{ fontSize: 13, marginBottom: 10 }}>
                Your rank:{' '}
                <b>{meIndex >= 0 ? `#${meIndex + 1}` : '—'}</b> | Your score:{' '}
                <b>{myRow?.total_score ?? 0}</b>
              </div>
            )}

            {/* Leaderboard */}
            <div
              style={{
                background: '#f8fafc',
                border: '1px solid #e5e7eb',
                borderRadius: 12,
                padding: 12,
                marginBottom: 14,
              }}
            >
              <div style={{ fontWeight: 800, marginBottom: 8 }}>Leaderboard</div>
              {rows.length === 0 ? (
                <div style={{ fontSize: 13, color: '#555' }}>
                  No scored picks yet (results need to be entered).
                </div>
              ) : (
                <div style={{ overflowX: 'auto' }}>
                  <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                    <thead>
                      <tr style={{ textAlign: 'left' }}>
                        <th style={{ padding: '6px 6px' }}>#</th>
                        <th style={{ padding: '6px 6px' }}>User</th>
                        <th style={{ padding: '6px 6px' }}>Score</th>
                        <th style={{ padding: '6px 6px' }}>Perfect</th>
                        <th style={{ padding: '6px 6px' }}>Scored</th>
                      </tr>
                    </thead>
                    <tbody>
                      {rows.slice(0, 20).map((row, idx) => {
                        const isMe = user && row.user_id === user.id
                        return (
                          <tr
                            key={`${row.event_id}-${row.user_id}`}
                            style={{
                              background: isMe ? '#fde68a' : 'transparent',
                            }}
                          >
                            <td style={{ padding: '6px 6px', borderTop: '1px solid #e5e7eb' }}>
                              {idx + 1}
                            </td>
                            <td style={{ padding: '6px 6px', borderTop: '1px solid #e5e7eb' }}>
                              <b>{row.username ?? row.user_id.slice(0, 8)}</b>
                              {isMe ? ' (you)' : ''}
                            </td>
                            <td style={{ padding: '6px 6px', borderTop: '1px solid #e5e7eb' }}>
                              <b>{row.total_score ?? 0}</b>
                            </td>
                            <td style={{ padding: '6px 6px', borderTop: '1px solid #e5e7eb' }}>
                              {row.perfect_picks ?? 0}
                            </td>
                            <td style={{ padding: '6px 6px', borderTop: '1px solid #e5e7eb' }}>
                              {row.scored_picks ?? 0}
                            </td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </div>

            {/* Fights */}
            {event.fights.map((fight) => {
              const pick = picks[fight.id]
              const finishType: FinishType = pick?.finishType ?? 'submission'
              const roundIrrelevant = isRoundIrrelevant(finishType)

              const isLocked = pick?.locked ?? false
              const inputsDisabled = isEventLocked || isLocked

              return (
                <div
                  key={fight.id}
                  style={{
                    background: '#eef1f4',
                    borderRadius: 12,
                    padding: 14,
                    marginBottom: 12,
                    opacity: isEventLocked ? 0.6 : 1,
                  }}
                >
                  <div
                    style={{
                      display: 'flex',
                      justifyContent: 'space-between',
                      alignItems: 'center',
                      marginBottom: 10,
                      fontWeight: 700,
                      gap: 10,
                      flexWrap: 'wrap',
                    }}
                  >
                    <span style={{ color: '#b91c1c' }}>{fight.fighter_red}</span>
                    <span>vs</span>
                    <span style={{ color: '#1d4ed8' }}>{fight.fighter_blue}</span>
                  </div>

                  <div style={{ fontSize: 14, fontWeight: 500, marginBottom: 6 }}>
                    {new Date(fight.fight_time).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}
                  </div>
                  <div style={{ marginBottom: 12, fontSize: 12, fontWeight: 500, color: isEventLocked ? '#777' : '#333' }}>
                    {isEventLocked ? 'Event locked' : 'Upcoming'}
                  </div>

                  <div style={{ display: 'flex', gap: 12, marginBottom: 12, flexWrap: 'wrap' }}>
                    <button
                      onClick={() => handlePick(fight.id, 'red', pick?.round ?? 1, pick?.finishType ?? 'submission')}
                      disabled={inputsDisabled}
                      style={{
                        flex: '1 1 180px',
                        minWidth: 180,
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
                      onClick={() => handlePick(fight.id, 'blue', pick?.round ?? 1, pick?.finishType ?? 'submission')}
                      disabled={inputsDisabled}
                      style={{
                        flex: '1 1 180px',
                        minWidth: 180,
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

                  {pick && (
                    <div style={{ background: '#fff', borderRadius: 10, padding: 12, marginBottom: 12, border: '1px solid #d1d5db' }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10 }}>
                        <div style={{ fontWeight: 700 }}>Confidence</div>
                        <div style={{ fontWeight: 800 }}>{pick.confidence}/10</div>
                      </div>
                      <input
                        type="range"
                        min={1}
                        max={10}
                        step={1}
                        value={pick.confidence}
                        disabled={inputsDisabled}
                        onChange={(e) => handleConfidence(fight.id, Number(e.target.value))}
                        style={{ width: '100%', marginTop: 10 }}
                      />
                      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, color: '#555' }}>
                        <span>1</span>
                        <span>10</span>
                      </div>
                    </div>
                  )}

                  {pick && (
                    <button
                      onClick={() => toggleLockPick(fight.id)}
                      disabled={isEventLocked}
                      style={{
                        padding: '8px 16px',
                        borderRadius: 8,
                        background: pick.locked ? '#f87171' : '#4ade80',
                        border: 'none',
                        fontWeight: 700,
                        cursor: isEventLocked ? 'not-allowed' : 'pointer',
                        marginBottom: 12,
                      }}
                    >
                      {pick.locked ? 'Unlock Pick' : 'Lock Pick'}
                    </button>
                  )}

                  <div style={{ display: 'flex', gap: 8, marginBottom: 12, flexWrap: 'wrap' }}>
                    {rounds.map((r) => (
                      <button
                        key={r}
                        onClick={() => {
                          const w = pick?.winner
                          const ft = pick?.finishType ?? 'submission'
                          if (!w) return alert('Pick a winner first.')
                          handlePick(fight.id, w, r, ft)
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

                  <div style={{ display: 'flex', gap: 8, marginBottom: 12, flexWrap: 'wrap' }}>
                    {finishes.map((f) => (
                      <button
                        key={f}
                        onClick={() => {
                          const w = pick?.winner
                          if (!w) return alert('Pick a winner first.')
                          handlePick(fight.id, w, pick?.round ?? 1, f)
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

                  {pick && (
                    <p style={{ marginTop: 8, fontWeight: 700, textTransform: 'uppercase', color: pick.winner === 'red' ? '#b91c1c' : '#1d4ed8', wordBreak: 'break-word' }}>
                      Your Pick: {pick.winner} | {roundIrrelevant ? 'N/A' : `Round ${pick.round}`} | {pick.finishType} | Confidence {pick.confidence}/10 {pick.locked ? '(Locked)' : '(Unlocked)'}
                    </p>
                  )}

                  {/* Admin Results Section */}
                  {isAdmin && (
                    <div style={{ background: '#e0e7ff', borderRadius: 10, padding: 12, marginTop: 12, border: '2px solid #6366f1' }}>
                      <div style={{ fontWeight: 800, marginBottom: 10, fontSize: 14 }}>Admin Results</div>
                      
                      {!event.results_open && (
                        <div style={{ background: '#fca5a5', padding: 10, borderRadius: 6, marginBottom: 10, fontSize: 13, fontWeight: 600, color: '#7f1d1d' }}>
                          Results are not open for this event yet.
                        </div>
                      )}
                      
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                        {/* Winner Select */}
                        <div>
                          <label style={{ display: 'block', fontWeight: 600, marginBottom: 6, fontSize: 13 }}>Winner</label>
                          <select
                            value={fightResults[fight.id]?.winner ?? ''}
                            onChange={(e) => {
                              const winner = e.target.value as 'red' | 'blue' | ''
                              setFightResults((prev) => ({
                                ...prev,
                                [fight.id]: {
                                  ...prev[fight.id],
                                  winner: winner === '' ? null : winner,
                                },
                              }))
                            }}
                            disabled={resultsLocked[fight.id] || !event.results_open}
                            style={{
                              width: '100%',
                              padding: '6px 8px',
                              borderRadius: 6,
                              border: '1px solid #999',
                              opacity: resultsLocked[fight.id] || !event.results_open ? 0.6 : 1,
                            }}
                          >
                            <option value="">-- Select --</option>
                            <option value="red">{fight.fighter_red}</option>
                            <option value="blue">{fight.fighter_blue}</option>
                          </select>
                        </div>

                        {/* Finish Type Select */}
                        <div>
                          <label style={{ display: 'block', fontWeight: 600, marginBottom: 6, fontSize: 13 }}>Finish Type</label>
                          <select
                            value={fightResults[fight.id]?.finishType ?? ''}
                            onChange={(e) => {
                              const finishType = e.target.value as FinishType | ''
                              setFightResults((prev) => ({
                                ...prev,
                                [fight.id]: {
                                  ...prev[fight.id],
                                  finishType: finishType === '' ? null : finishType,
                                },
                              }))
                            }}
                            disabled={resultsLocked[fight.id] || !event.results_open}
                            style={{
                              width: '100%',
                              padding: '6px 8px',
                              borderRadius: 6,
                              border: '1px solid #999',
                              opacity: resultsLocked[fight.id] || !event.results_open ? 0.6 : 1,
                            }}
                          >
                            <option value="">-- Select --</option>
                            {finishes.map((f) => (
                              <option key={f} value={f}>
                                {f}
                              </option>
                            ))}
                          </select>
                        </div>

                        {/* Round Select */}
                        <div>
                          <label style={{ display: 'block', fontWeight: 600, marginBottom: 6, fontSize: 13 }}>Round</label>
                          <select
                            value={fightResults[fight.id]?.round ?? ''}
                            onChange={(e) => {
                              const round = e.target.value === '' ? null : Number(e.target.value)
                              setFightResults((prev) => ({
                                ...prev,
                                [fight.id]: {
                                  ...prev[fight.id],
                                  round,
                                },
                              }))
                            }}
                            disabled={
                              resultsLocked[fight.id] ||
                              !event.results_open ||
                              (fightResults[fight.id]?.finishType
                                ? isRoundIrrelevant(fightResults[fight.id].finishType!)
                                : false)
                            }
                            style={{
                              width: '100%',
                              padding: '6px 8px',
                              borderRadius: 6,
                              border: '1px solid #999',
                              opacity:
                                resultsLocked[fight.id] ||
                                !event.results_open ||
                                (fightResults[fight.id]?.finishType
                                  ? isRoundIrrelevant(fightResults[fight.id].finishType!)
                                  : false)
                                  ? 0.6
                                  : 1,
                            }}
                          >
                            <option value="">-- Select --</option>
                            {[1, 2, 3, 4, 5].map((r) => (
                              <option key={r} value={r}>
                                {r}
                              </option>
                            ))}
                          </select>
                        </div>
                      </div>

                      {/* Admin Buttons */}
                      <div style={{ display: 'flex', gap: 8, marginTop: 12, flexWrap: 'wrap' }}>
                        <button
                          onClick={() => handleAdminSaveResult(fight.id)}
                          disabled={resultsLocked[fight.id] || !event.results_open}
                          style={{
                            padding: '8px 16px',
                            borderRadius: 6,
                            background: '#10b981',
                            color: '#fff',
                            border: 'none',
                            fontWeight: 700,
                            cursor: resultsLocked[fight.id] || !event.results_open ? 'not-allowed' : 'pointer',
                            opacity: resultsLocked[fight.id] || !event.results_open ? 0.6 : 1,
                          }}
                        >
                          Save Results
                        </button>
                        <button
                          onClick={() => handleAdminLockResults(fight.id)}
                          disabled={resultsLocked[fight.id]}
                          style={{
                            padding: '8px 16px',
                            borderRadius: 6,
                            background: '#f59e0b',
                            color: '#fff',
                            border: 'none',
                            fontWeight: 700,
                            cursor: resultsLocked[fight.id] ? 'not-allowed' : 'pointer',
                            opacity: resultsLocked[fight.id] ? 0.6 : 1,
                          }}
                        >
                          Lock Results
                        </button>
                        {resultsLocked[fight.id] && (
                          <button
                            onClick={() => handleAdminUnlockResults(fight.id)}
                            style={{
                              padding: '8px 16px',
                              borderRadius: 6,
                              background: '#ef4444',
                              color: '#fff',
                              border: 'none',
                              fontWeight: 700,
                              cursor: 'pointer',
                            }}
                          >
                            Unlock Results
                          </button>
                        )}
                      </div>
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        )
      })}
    </main>
  )
}


