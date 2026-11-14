import Dashboard from "../dashboard";
export const dynamic = "force-dynamic";
export default function OperationsPage() {
  return (
    <Dashboard
      demo={
        process.env.DEMO_MODE === "true" ||
        process.env.NODE_ENV !== "production"
      }
    />
  );
}
