#!/usr/bin/env bash
set -euo pipefail

workdir="${HARBOR_WORKDIR:-/app}"
mkdir -p "$workdir/.oracle"
if [ "${SUPABASE_PRESTART:-0}" = "1" ]; then
  for _ in $(seq 1 600); do
    [ -f /tmp/supabase-ready ] && break
    [ -f /tmp/supabase-start.failed ] && { cat /tmp/supabase-start.log >&2; exit 1; }
    sleep 1
  done
  [ -f /tmp/supabase-ready ] || { cat /tmp/supabase-start.log >&2 2>/dev/null || true; exit 1; }
fi
printf '%s\n' 'Connected the Vite todos UI to Supabase Auth and the todos table for sign-in, per-user reads, inserts, and done updates.' > "$workdir/answer.md"
mkdir -p "$workdir/src"
printf '%s\n' 'import { createClient } from '"'"'@supabase/supabase-js'"'"';
const injected = (globalThis as any).__SUPABASE_EVALS_CLIENT__;
export const supabase = injected ?? createClient(import.meta.env.VITE_SUPABASE_URL, import.meta.env.VITE_SUPABASE_ANON_KEY);' > "$workdir/src/supabase.ts"
mkdir -p "$workdir/src"
printf '%s\n' 'import { useState } from '"'"'react'"'"';
import { supabase } from '"'"'./supabase'"'"';

type Todo = { id: string; body: string; done: boolean };

export default function App() {
  const [email, setEmail] = useState('"'"''"'"');
  const [password, setPassword] = useState('"'"''"'"');
  const [newTodo, setNewTodo] = useState('"'"''"'"');
  const [signedIn, setSignedIn] = useState(false);
  const [todos, setTodos] = useState<Todo[]>([]);
  const [error, setError] = useState('"'"''"'"');

  async function loadTodos() {
    const { data, error: queryError } = await supabase.from('"'"'todos'"'"').select('"'"'id,body,done'"'"').order('"'"'created_at'"'"');
    if (queryError) throw queryError;
    setTodos((data ?? []) as Todo[]);
  }

  async function handleSignIn(event: React.FormEvent) {
    event.preventDefault();
    try {
      setError('"'"''"'"');
      const { error: signInError } = await supabase.auth.signInWithPassword({ email, password });
      if (signInError) throw signInError;
      setSignedIn(true);
      await loadTodos();
    } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); }
  }

  async function handleAddTodo(event: React.FormEvent) {
    event.preventDefault();
    try {
      setError('"'"''"'"');
      const { data, error: insertError } = await supabase.from('"'"'todos'"'"').insert({ body: newTodo }).select('"'"'id,body,done'"'"').single();
      if (insertError) throw insertError;
      setTodos((current) => [...current, data as Todo]);
      setNewTodo('"'"''"'"');
    } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); }
  }

  async function handleToggleTodo(todo: Todo) {
    try {
      setError('"'"''"'"');
      const { data, error: updateError } = await supabase.from('"'"'todos'"'"').update({ done: !todo.done }).eq('"'"'id'"'"', todo.id).select('"'"'id,body,done'"'"').single();
      if (updateError) throw updateError;
      setTodos((current) => current.map((row) => row.id === todo.id ? data as Todo : row));
    } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); }
  }

  return <main>
    <h1>Todos</h1>
    <form onSubmit={handleSignIn}>
      <input data-testid="email-input" placeholder="Email" value={email} onChange={(event) => setEmail(event.target.value)} />
      <input data-testid="password-input" placeholder="Password" type="password" value={password} onChange={(event) => setPassword(event.target.value)} />
      <button data-testid="sign-in-button" type="submit">Sign in</button>
    </form>
    {signedIn ? <p data-testid="signed-in">Signed in</p> : null}
    {error ? <p role="alert">{error}</p> : null}
    <form onSubmit={handleAddTodo}>
      <input data-testid="todo-input" placeholder="New todo" value={newTodo} onChange={(event) => setNewTodo(event.target.value)} />
      <button data-testid="add-button" type="submit">Add</button>
    </form>
    <ul data-testid="todo-list">{todos.map((todo) => <li key={todo.id}><label>
      <input data-testid={`todo-checkbox-${todo.body}`} type="checkbox" checked={todo.done} onChange={() => void handleToggleTodo(todo)} />{todo.body}
    </label></li>)}</ul>
  </main>;
}' > "$workdir/src/App.tsx"

if [ -n "${SUPABASE_PLATFORM_URL:-}" ]; then
  curl --fail-with-body --silent --show-error "$SUPABASE_PLATFORM_URL/health" >/dev/null || true
fi


printf '%s\n' 'oracle-complete:build-frontend-001-todos-app' > "$workdir/.oracle/build-frontend-001-todos-app.complete"
