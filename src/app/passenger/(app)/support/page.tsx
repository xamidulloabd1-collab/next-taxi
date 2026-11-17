import { PageShell } from "@/components/shared/page-shell";
import { SupportCenter } from "@/components/shared/support-center";

export const metadata = { title: "Yordam" };

export default async function Page({ searchParams }: { searchParams: Promise<{ ride?: string }> }) {
  const { ride } = await searchParams;
  return (
    <PageShell title="Yordam">
      <SupportCenter app="passenger" rideId={ride && /^[0-9a-f-]{36}$/.test(ride) ? ride : undefined} />
    </PageShell>
  );
}
