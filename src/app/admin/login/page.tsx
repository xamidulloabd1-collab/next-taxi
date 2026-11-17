import { LoginForm } from "@/components/auth/login-form";
export const metadata = { title: "Boshqaruv paneli" };
export default function Page() {
  return <LoginForm app="admin" />;
}
