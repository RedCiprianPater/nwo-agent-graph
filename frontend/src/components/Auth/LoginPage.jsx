/**
 * LoginPage.jsx
 * Sign in with email magic link OR cardiac heartbeat identity.
 * Cardiac flow: RR intervals → Oracle → rootTokenId → session.
 */

import { useState } from 'react';
import { signInWithEmail, signInWithGoogle } from '../../api/authApi';
import cardiac from '../../api/cardiacApi';

const s = {
  wrap:    { minHeight:'100vh', background:'#08080f', display:'flex', alignItems:'center', justifyContent:'center', padding:16 },
  card:    { background:'#10101c', border:'1px solid #2a2a40', borderRadius:16, padding:'36px 32px', width:400, maxWidth:'100%' },
  logo:    { fontSize:28, marginBottom:4, textAlign:'center' },
  title:   { fontSize:20, fontWeight:500, color:'#e8e6f0', textAlign:'center', marginBottom:6 },
  sub:     { fontSize:13, color:'#666688', textAlign:'center', marginBottom:28 },
  label:   { fontSize:11, color:'#666688', display:'block', marginBottom:5, letterSpacing:1 },
  input:   { width:'100%', background:'#0a0a14', border:'1px solid #2a2a40', borderRadius:8, color:'#ccccdd', fontSize:14, padding:'10px 12px', outline:'none', fontFamily:'inherit', marginBottom:12 },
  btn:     (color) => ({ width:'100%', padding:'11px 0', borderRadius:8, border:`1px solid ${color}44`, background:`${color}18`, color, cursor:'pointer', fontSize:14, fontWeight:500, marginBottom:8 }),
  divider: { display:'flex', alignItems:'center', gap:10, margin:'16px 0', color:'#3a3a55', fontSize:12 },
  line:    { flex:1, height:1, background:'#1e1e30' },
  msg:     (ok) => ({ padding:'10px 12px', borderRadius:8, background: ok ? '#1D9E7518' : '#D85A3018', border:`1px solid ${ok ? '#1D9E75' : '#D85A30'}44`, color: ok ? '#1D9E75' : '#D85A30', fontSize:13, marginBottom:12 }),
  tabs:    { display:'flex', gap:0, marginBottom:24, borderRadius:8, overflow:'hidden', border:'1px solid #2a2a40' },
  tab:     (active) => ({ flex:1, padding:'9px 0', border:'none', background: active ? '#1a1a2e' : 'transparent', color: active ? '#ccccdd' : '#555577', cursor:'pointer', fontSize:13, fontWeight: active ? 500 : 400 }),
  cardiac: { background:'#14141f', border:'1px solid #2a2a40', borderRadius:10, padding:16, marginBottom:12 },
};

export default function LoginPage({ onLogin }) {
  const [tab,       setTab]       = useState('email');    // 'email' | 'cardiac'
  const [email,     setEmail]     = useState('');
  const [sent,      setSent]      = useState(false);
  const [wallet,    setWallet]    = useState('');
  const [rrInput,   setRrInput]   = useState('');         // comma-separated RR intervals
  const [device,    setDevice]    = useState('apple_watch');
  const [loading,   setLoading]   = useState(false);
  const [error,     setError]     = useState('');
  const [cardiacOk, setCardiacOk] = useState(false);

  // ---------------------------------------------------------------
  // Email magic link
  // ---------------------------------------------------------------
  async function handleEmailLogin() {
    if (!email.trim()) return;
    setLoading(true); setError('');
    try {
      await signInWithEmail(email.trim());
      setSent(true);
    } catch (e) {
      setError(e.message);
    }
    setLoading(false);
  }

  async function handleGoogle() {
    setLoading(true); setError('');
    try { await signInWithGoogle(); } catch (e) { setError(e.message); }
    setLoading(false);
  }

  // ---------------------------------------------------------------
  // Cardiac heartbeat login
  // ---------------------------------------------------------------
  async function handleCardiacLogin() {
    if (!wallet.trim() || !rrInput.trim()) { setError('Enter wallet address and RR intervals'); return; }
    setLoading(true); setError('');

    try {
      // Parse RR intervals
      const rrIntervals = rrInput.split(/[,\s]+/).map(Number).filter(n => n > 200 && n < 2000);
      if (rrIntervals.length < 3) {
        setError('Need at least 3 valid RR intervals (200–2000 ms)');
        setLoading(false); return;
      }

      // Step 1: validate ECG with Oracle
      const { cardiacHash, valid } = await cardiac.validateECG(wallet.trim(), rrIntervals, device);
      if (!valid) { setError('ECG validation failed. Check your RR intervals.'); setLoading(false); return; }

      // Step 2: lookup identity
      const { rootTokenId, active } = await cardiac.identifyByCardiac(cardiacHash);
      if (!rootTokenId || !active) {
        setError('No active cardiac identity found. Please register first or use email login.');
        setLoading(false); return;
      }

      // Step 3: sign in with Supabase using cardiac hash as magic token
      // In production, the Oracle would issue a signed JWT; here we use it as email OTP token
      await signInWithEmail(`cardiac_${rootTokenId}@nwo.cardiac`);
      setCardiacOk(true);
      setSent(true);

    } catch (e) {
      setError(e.message || 'Cardiac login failed');
    }
    setLoading(false);
  }

  // ---------------------------------------------------------------
  // Demo mode: simulate RR intervals from wrist input
  // ---------------------------------------------------------------
  function fillDemoRR() {
    setRrInput('820, 810, 830, 795, 815, 808, 822, 801, 819, 813');
  }

  return (
    <div style={s.wrap}>
      <div style={s.card}>
        <div style={s.logo}>⬡</div>
        <div style={s.title}>NWO Agent Graph</div>
        <div style={s.sub}>Sign in to access your private graph and manage your robots</div>

        {/* Tabs */}
        <div style={s.tabs}>
          <button style={s.tab(tab === 'email')} onClick={() => setTab('email')}>Email</button>
          <button style={s.tab(tab === 'cardiac')} onClick={() => setTab('cardiac')}>⬡ Cardiac ID</button>
        </div>

        {error && <div style={s.msg(false)}>{error}</div>}

        {/* Email tab */}
        {tab === 'email' && !sent && (
          <>
            <label style={s.label}>EMAIL</label>
            <input
              style={s.input}
              type="email"
              placeholder="you@example.com"
              value={email}
              onChange={e => setEmail(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && handleEmailLogin()}
              autoFocus
            />
            <button style={s.btn('#1D9E75')} onClick={handleEmailLogin} disabled={loading || !email}>
              {loading ? 'Sending…' : 'Send magic link'}
            </button>

            <div style={s.divider}><span style={s.line}/><span>or</span><span style={s.line}/></div>

            <button style={s.btn('#7F77DD')} onClick={handleGoogle} disabled={loading}>
              Continue with Google
            </button>
          </>
        )}

        {/* Cardiac tab */}
        {tab === 'cardiac' && !sent && (
          <>
            <div style={s.cardiac}>
              <div style={{ fontSize:12, color:'#8888aa', marginBottom:10, lineHeight:1.5 }}>
                Your ECG heartbeat is your identity. Enter your wallet address and RR intervals from your smart watch.
              </div>

              <label style={s.label}>WALLET ADDRESS (Base Mainnet)</label>
              <input style={s.input} placeholder="0x..." value={wallet} onChange={e => setWallet(e.target.value)} />

              <label style={s.label}>DEVICE</label>
              <select style={{ ...s.input, cursor:'pointer' }} value={device} onChange={e => setDevice(e.target.value)}>
                <option value="apple_watch">Apple Watch</option>
                <option value="wear_os">Wear OS</option>
                <option value="fitbit">Fitbit</option>
                <option value="garmin">Garmin</option>
              </select>

              <label style={s.label}>RR INTERVALS (ms, comma-separated)</label>
              <input style={s.input} placeholder="820, 810, 830, 795, 815..." value={rrInput} onChange={e => setRrInput(e.target.value)} />
              <button
                style={{ ...s.btn('#444466'), fontSize:11, padding:'5px 0', marginBottom:8 }}
                onClick={fillDemoRR}
              >
                Insert demo RR intervals
              </button>
            </div>

            <button style={s.btn('#D85A30')} onClick={handleCardiacLogin} disabled={loading || !wallet || !rrInput}>
              {loading ? 'Verifying ECG…' : '⬡ Sign in with heartbeat'}
            </button>

            <div style={{ fontSize:11, color:'#444466', textAlign:'center', marginTop:8 }}>
              NWO Oracle · Base Mainnet · Soul-bound identity
            </div>
          </>
        )}

        {/* Sent state */}
        {sent && (
          <div style={s.msg(true)}>
            {cardiacOk
              ? '⬡ Cardiac identity verified. Check your email for the sign-in link.'
              : '✉ Magic link sent. Check your email to complete sign-in.'}
          </div>
        )}

        <div style={{ marginTop:20, fontSize:11, color:'#333355', textAlign:'center', lineHeight:1.6 }}>
          Public graph is visible without an account.<br/>
          Sign in to access private nodes, manage robots, and view telemetry.
        </div>
      </div>
    </div>
  );
}
