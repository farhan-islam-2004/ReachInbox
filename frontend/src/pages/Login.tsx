import React, { useState, useEffect } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { AlertCircle } from 'lucide-react';

export const Login: React.FC = () => {
  const { isAuthenticated, login, loading } = useAuth();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const oauthError = searchParams.get('error');

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');

  useEffect(() => {
    if (isAuthenticated) {
      navigate('/scheduled', { replace: true });
    }
  }, [isAuthenticated, navigate]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    // Connects to Google OAuth flow as required by the backend
    login();
  };

  return (
    <div className="min-h-screen bg-white flex items-center justify-center p-4 select-none">
      {/* Centered Login Card matching exact examiner design */}
      <div className="w-full max-w-[420px] bg-white rounded-2xl border border-gray-100 shadow-[0_4px_25px_rgba(0,0,0,0.06)] p-8 sm:p-10 animate-in fade-in zoom-in-95 duration-200">
        {/* Title */}
        <h1 className="text-3xl font-bold text-gray-900 text-center mb-8 tracking-tight">
          Login
        </h1>

        {/* OAuth Error Alert if returned from callback */}
        {oauthError && (
          <div className="mb-6 p-3.5 rounded-lg bg-red-50 border border-red-200 text-xs text-red-700 flex items-start space-x-2">
            <AlertCircle className="w-4 h-4 text-red-600 flex-shrink-0 mt-0.5" />
            <div className="flex-1">
              <span className="font-semibold block">Authorization Failed</span>
              <span className="text-slate-600">
                {oauthError === 'invalid_client'
                  ? 'Invalid Google Client configuration. Please check your credentials.'
                  : oauthError}
              </span>
            </div>
          </div>
        )}

        {/* Google Login Button */}
        <button
          type="button"
          onClick={login}
          disabled={loading}
          className="w-full py-3 px-4 bg-[#e8f5e9] hover:bg-[#dcf0de] text-gray-800 text-sm font-medium rounded-lg flex items-center justify-center space-x-2.5 transition-colors disabled:opacity-60"
        >
          {/* Official Google G Icon */}
          <svg className="w-4 h-4" viewBox="0 0 24 24">
            <path
              fill="#4285F4"
              d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
            />
            <path
              fill="#34A853"
              d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
            />
            <path
              fill="#FBBC05"
              d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.06H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.94l2.85-2.22.81-.63z"
            />
            <path
              fill="#EA4335"
              d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.06l3.66 2.84c.87-2.6 3.3-4.52 6.16-4.52z"
            />
          </svg>
          <span>Login with Google</span>
        </button>

        {/* Divider with subtle line */}
        <div className="relative my-7 text-center">
          <div className="absolute inset-0 flex items-center">
            <div className="w-full border-t border-gray-200"></div>
          </div>
          <div className="relative flex justify-center">
            <span className="bg-white px-3 text-xs text-gray-400 font-normal">
              or sign up through email
            </span>
          </div>
        </div>

        {/* Credentials Form */}
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <input
              type="text"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="Email ID"
              className="w-full py-3.5 px-4 bg-[#f3f4f6] text-gray-900 text-sm rounded-lg focus:outline-none focus:ring-2 focus:ring-[#00a63e]/30 placeholder:text-gray-400 border-0 transition-all"
            />
          </div>

          <div>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Password"
              className="w-full py-3.5 px-4 bg-[#f3f4f6] text-gray-900 text-sm rounded-lg focus:outline-none focus:ring-2 focus:ring-[#00a63e]/30 placeholder:text-gray-400 border-0 transition-all"
            />
          </div>

          {/* Solid Green Login Button */}
          <div className="pt-2">
            <button
              type="submit"
              disabled={loading}
              className="w-full py-3.5 bg-[#00a63e] hover:bg-[#009237] text-white text-sm font-medium rounded-lg transition-colors shadow-sm active:scale-[0.99] disabled:opacity-70"
            >
              Login
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
