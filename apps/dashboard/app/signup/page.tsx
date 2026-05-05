import { AuthForm } from "../../components/auth-form";

export default function SignupPage() {
  return (
    <main className="page-shell" style={{ padding: "48px 0" }}>
      <AuthForm mode="signup" />
    </main>
  );
}

