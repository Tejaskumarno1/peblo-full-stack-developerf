import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { useGoogleLogin } from '@react-oauth/google';
import '../styles/auth.css';

export default function LoginPage() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const navigate = useNavigate();
  const { login, googleLogin: useAuthContextGoogleLogin } = useAuth();

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (loading) return; // Prevent double-submit
    setError('');
    setLoading(true);
    try {
      await login(email, password);
      navigate('/');
    } catch (err) {
      if (err.response?.status === 429) {
        setError('Too many login attempts. Please wait a minute and try again.');
      } else {
        const errData = err.response?.data?.error;
        const errMsg = typeof errData === 'string' ? errData 
                     : errData?.message || err.message || 'Login failed';
        setError(errMsg);
      }
    } finally {
      setLoading(false);
    }
  };

  const googleLoginAction = useGoogleLogin({
    flow: 'auth-code',
    scope: 'openid email profile https://www.googleapis.com/auth/calendar.events',
    onSuccess: async (tokenResponse) => {
      setError('');
      setLoading(true);
      try {
        await useAuthContextGoogleLogin({ code: tokenResponse.code });
        navigate('/');
      } catch (err) {
        console.error('Google Login Error:', err.response?.data || err);
        setError(err.response?.data?.error || err.response?.data?.details || 'Google login failed on backend');
      } finally {
        setLoading(false);
      }
    },
    onError: () => setError('Google Login Failed')
  });

  return (
    <div className="auth-split-layout">
      <div className="auth-brand-panel">
        <div className="brand-content">
          <div className="brand-logo">
            <span className="logo-icon">P</span>
            <h2>Peblo Notes</h2>
          </div>
          <div className="brand-value-prop">
            <h1>Capture ideas at the speed of thought.</h1>
            <p>Your AI-powered workspace to write, organize, and synthesize information effortlessly.</p>
          </div>
          <div className="brand-testimonial">
            <p>"Peblo completely changed how I organize my research. The AI summaries are magic."</p>
            <div className="testimonial-author">
              <span className="author-avatar">S</span>
              <div>
                <span className="author-name">Sarah Jenkins</span>
                <span className="author-title">Product Designer</span>
              </div>
            </div>
          </div>
        </div>
      </div>

      <div className="auth-form-panel">
        <div className="auth-form-container">
          <h2>Welcome back</h2>
          <p className="auth-subtitle">Log in to your account to continue</p>
          
          <button className="btn-sso" type="button" onClick={() => googleLoginAction()}>
            <svg className="google-icon" viewBox="0 0 24 24">
              <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/>
              <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
              <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"/>
              <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/>
            </svg>
            Continue with Google
          </button>

          <div className="auth-divider">
            <span>or log in with email</span>
          </div>

          {error && <div className="auth-error">{error}</div>}
          
          <form onSubmit={handleSubmit} className="auth-form">
            <div className="form-group">
              <label>Email Address</label>
              <input
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@example.com"
              />
            </div>
            <div className="form-group">
              <label>Password</label>
              <div className="password-input-wrapper">
                <input
                  type={showPassword ? "text" : "password"}
                  required
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="••••••••"
                />
                <button 
                  type="button" 
                  className="btn-toggle-password"
                  onClick={() => setShowPassword(!showPassword)}
                >
                  {showPassword ? 'Hide' : 'Show'}
                </button>
              </div>
            </div>
            <button type="submit" className="btn btn-primary btn-full" disabled={loading}>
              {loading ? 'Logging in...' : 'Log In'}
            </button>
          </form>
          
          <p className="auth-footer">
            Don't have an account? <Link to="/signup">Sign up</Link>
          </p>
        </div>
      </div>
    </div>
  );
}
