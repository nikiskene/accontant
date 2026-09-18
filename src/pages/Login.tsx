import { useState, FormEvent } from 'react';
import { supabase } from '../lib/supabase';
import { Button } from '../components/Button';
import { Input } from '../components/Input';

export function Login() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);

    try {
      const { error } = await supabase.auth.signInWithPassword({
        email,
        password,
      });

      if (error) throw error;
    } catch (err: any) {
      setError(err.message || 'Failed to sign in');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="relative min-h-screen overflow-hidden bg-gray-950">
      <img src="https://ndktajhxihahgfdcsuij.supabase.co/storage/v1/object/public/homepage-media/Portrait%20Niki%202026.png" alt="Nikolaus Skene" className="absolute inset-0 h-full w-full object-cover object-center" />
      <div className="absolute inset-0 bg-gradient-to-r from-black/80 via-black/45 to-black/20" />
      <div className="relative flex min-h-screen flex-col justify-between p-5 sm:p-10 lg:p-16">
        <h1 className="max-w-3xl text-4xl font-bold tracking-tight text-white drop-shadow-lg sm:text-6xl lg:text-7xl">Nikolaus Skene Accountant</h1>
        <div className="w-full self-end rounded-2xl bg-white/95 p-6 shadow-2xl backdrop-blur sm:max-w-md sm:p-8">
          <div className="mb-6"><p className="text-xs font-semibold uppercase tracking-[.2em] text-blue-700">Secure access</p><h2 className="mt-1 text-2xl font-bold text-gray-900">Sign in</h2></div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <Input
            type="email"
            label="Email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="ns@iacy.com"
            required
          />

          <Input
            type="password"
            label="Password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="Enter your password"
            required
          />

          {error && (
            <div className="bg-red-50 border border-red-200 text-red-800 px-4 py-3 rounded-lg text-sm">
              {error}
            </div>
          )}

          <Button type="submit" disabled={loading} className="w-full">
            {loading ? 'Signing in...' : 'Sign In'}
          </Button>
        </form></div>
      </div>
    </div>
  );
}
