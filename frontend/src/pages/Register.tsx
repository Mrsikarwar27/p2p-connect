import { useState, type FormEvent } from "react";
import { Link, useNavigate } from "react-router-dom";
import { ConnectionCard } from "../components/connection/ConnectionCard";
import { useAuth } from "../context/AuthContext";
import { ApiError } from "../services/api";

const inputClass =
  "mt-2 w-full rounded-xl border border-border bg-panel2 px-4 py-3 text-sm text-ink placeholder:text-muted/40 focus:border-primary/60 focus:outline-none";

export function Register() {
  const { register } = useAuth();
  const navigate = useNavigate();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!name.trim() || !email.trim() || !username.trim() || !password) {
      setError("Please fill in every field.");
      return;
    }
    if (password.length < 8) {
      setError("Password must be at least 8 characters.");
      return;
    }
    setError(null);
    setPending(true);
    try {
      await register({
        name: name.trim(),
        email: email.trim(),
        username: username.trim(),
        password,
      });
      navigate("/", { replace: true });
    } catch (err) {
      setError(
        err instanceof ApiError ? err.message : "Could not create the account. Please try again.",
      );
    } finally {
      setPending(false);
    }
  };

  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-surface px-4 py-10">
      <div className="mb-6 text-center">
        <Link
          to="/"
          className="font-display text-3xl font-extrabold tracking-tight text-ink"
        >
          P2P <span className="text-primary">Connect</span>
        </Link>
        <p className="mt-2 text-sm text-muted">
          Create an account to save your name and username. Accounts are optional.
        </p>
      </div>

      <ConnectionCard>
        <h2 className="font-display text-lg font-bold text-ink">Create your account</h2>
        <p className="mt-1 text-xs text-muted">
          No email verification, no social login — just a name and a username.
        </p>

        <form onSubmit={submit} className="mt-5 space-y-4">
          <div>
            <label className="text-xs font-medium uppercase tracking-widest text-muted">
              Display name
            </label>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Enter your name"
              maxLength={60}
              autoComplete="name"
              className={inputClass}
            />
          </div>
          <div>
            <label className="text-xs font-medium uppercase tracking-widest text-muted">
              Email
            </label>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@example.com"
              autoComplete="email"
              className={inputClass}
            />
          </div>
          <div>
            <label className="text-xs font-medium uppercase tracking-widest text-muted">
              Username
            </label>
            <input
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              placeholder="vijay_27"
              maxLength={20}
              autoComplete="username"
              className={`${inputClass} font-mono`}
            />
            <p className="mt-1 text-[11px] text-muted/70">
              3-20 characters: letters, numbers and underscores.
            </p>
          </div>
          <div>
            <label className="text-xs font-medium uppercase tracking-widest text-muted">
              Password
            </label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="At least 8 characters"
              autoComplete="new-password"
              className={inputClass}
            />
          </div>

          {error && (
            <p className="rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-300">
              {error}
            </p>
          )}

          <button
            type="submit"
            disabled={pending}
            className="w-full rounded-xl bg-primary px-4 py-3 font-display text-sm font-bold text-[#13131B] transition hover:brightness-110 disabled:opacity-50"
          >
            {pending ? "Creating..." : "Create account"}
          </button>
        </form>

        <p className="mt-4 text-center text-xs text-muted">
          Already have an account?{" "}
          <Link to="/login" className="font-semibold text-primary hover:underline">
            Log in
          </Link>
        </p>

        <div className="my-5 flex items-center gap-3 text-xs text-muted">
          <div className="h-px flex-1 bg-border" />
          <span>OR</span>
          <div className="h-px flex-1 bg-border" />
        </div>

        <button
          type="button"
          onClick={() => navigate("/")}
          className="w-full rounded-xl bg-panel3 px-4 py-3 text-sm font-semibold text-ink transition hover:brightness-125"
        >
          Continue as Guest
        </button>
      </ConnectionCard>
    </div>
  );
}
