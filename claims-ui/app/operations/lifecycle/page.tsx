"use client";

import { LifecycleCockpit } from "@/components/operations/LifecycleCockpit";
import { PageHeader } from "@/components/shared/PageHeader";

export default function OperationsLifecyclePage() {
  return (
    <div className="acos-page">
      <PageHeader title="Claim Journey Monitor" />
      <LifecycleCockpit />
    </div>
  );
}
