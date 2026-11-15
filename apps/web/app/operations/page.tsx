import Dashboard from "../dashboard";
import { publicDemoEnabled } from "../api/demo-mode";
export const dynamic = "force-dynamic";
export default function OperationsPage() {
  const publicDemo = publicDemoEnabled();
  return (
    <Dashboard
      demo={
        publicDemo ||
        process.env.DEMO_MODE === "true" ||
        process.env.NODE_ENV !== "production"
      }
      publicDemo={publicDemo}
    />
  );
}
