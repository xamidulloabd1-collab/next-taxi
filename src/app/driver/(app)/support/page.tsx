import { PageShell } from "@/components/shared/page-shell";
import { SupportCenter } from "@/components/shared/support-center";

export const metadata = { title: "Yordam" };

export default function Page() {
  return (
    <PageShell title="Yordam">
      <SupportCenter app="driver" />
    </PageShell>
  );
}
