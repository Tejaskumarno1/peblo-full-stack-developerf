import { useState, useEffect } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { Sparkles, Tag, BarChart3 } from 'lucide-react';
import '../styles/auth.css';

export default function SignupPage() {
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [passwordStrength, setPasswordStrength] = useState(0);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const navigate = useNavigate();
  const { signup } = useAuth();

  useEffect(() => {
    // Simple password strength calculator
    let strength = 0;
    if (password.length > 0) strength = 1;
    if (password.length > 5) strength = 2;
    if (password.length >= 8 && /[A-Z]/.test(password) && /[0-9]/.test(password)) strength = 3;
    if (password.length >= 10 && /[^A-Za-z0-9]/.test(password)) strength = 4;
    setPasswordStrength(strength);
  }, [password]);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      await signup(name, email, password);
      navigate('/');
    } catch (err) {
      const errData = err.response?.data?.error;
      const errMsg = typeof errData === 'string' ? errData 
                   : errData?.message || err.message || 'Signup failed';
      setError(errMsg);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="auth-split-layout">
      <div className="auth-brand-panel signup-brand">
        <div className="brand-content">
          <div className="brand-logo">
            <span className="logo-icon">P</span>
            <h2>Peblo Notes</h2>
          </div>
          <div className="brand-value-prop">
            <h1>Start organizing your thoughts today.</h1>
            <p>Join thousands of professionals who write better and faster with Peblo.</p>
          </div>
          <div className="brand-features">
            <div className="feature-item">
              <span className="feature-icon" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <Sparkles size={18} color="var(--accent-violet)" />
              </span>
              <span>AI-powered summaries and action items</span>
            </div>
            <div className="feature-item">
              <span className="feature-icon" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <Tag size={18} color="var(--accent-teal)" />
              </span>
              <span>Flexible tagging and semantic search</span>
            </div>
            <div className="feature-item">
              <span className="feature-icon" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <BarChart3 size={18} color="var(--accent-amber)" />
              </span>
              <span>Visual dashboard of your writing habits</span>
            </div>
          </div>
        </div>
      </div>

      <div className="auth-form-panel">
        <div className="auth-form-container">
          <h2>Create an account</h2>
          <p className="auth-subtitle">Get started with Peblo Notes for free</p>
          
          <button className="btn-sso" type="button">
            <svg className="google-icon" viewBox="0 0 24 24">
              <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/>
              <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
              <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"/>
              <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/>
            </svg>
            Sign up with Google
          </button>

          <div className="auth-divider">
            <span>or sign up with email</span>
          </div>

          {error && <div className="auth-error">{error}</div>}
          
          <form onSubmit={handleSubmit} className="auth-form">
            <div className="form-group">
              <label>Full Name</label>
              <input
                type="text"
                required
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Jane Doe"
              />
            </div>
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
                  placeholder="Create a strong password"
                />
                <button 
                  type="button" 
                  className="btn-toggle-password"
                  onClick={() => setShowPassword(!showPassword)}
                >
                  {showPassword ? 'Hide' : 'Show'}
                </button>
              </div>
              {password.length > 0 && (
                <div className="password-strength-meter">
                  <div className={`strength-bar strength-${passwordStrength}`}>
                    <div className="bar segment-1"></div>
                    <div className="bar segment-2"></div>
                    <div className="bar segment-3"></div>
                    <div className="bar segment-4"></div>
                  </div>
                  <span className="strength-text">
                    {passwordStrength === 1 ? 'Weak' : passwordStrength === 2 ? 'Fair' : passwordStrength === 3 ? 'Good' : 'Strong'}
                  </span>
                </div>
              )}
            </div>
            <button type="submit" className="btn btn-primary btn-full" disabled={loading}>
              {loading ? 'Creating account...' : 'Create Account'}
            </button>
          </form>
          
          <p className="auth-footer">
            Already have an account? <Link to="/login">Log in</Link>
          </p>
        </div>
      </div>
    </div>
  );
}
