import { useState } from "react";
import { probeSavedLlm } from "@/api/client";
import ModelInput from "./ModelInput";
import LlmProbeControls from "./LlmProbeControls";

/** Mount once per connection revision so fetched models cannot cross credentials. */
export default function RoleModelField({ target, value, models, disabled, onSave }: {
  target: "generation" | "agent"; value: string; models: string[]; disabled: boolean;
  onSave: (model: string) => Promise<void>;
}) {
  const [remoteModels, setRemoteModels] = useState<string[] | null>(null);
  const [dirty, setDirty] = useState(false);
  return <div className="role-model-field">
    <ModelInput value={value} models={remoteModels ?? models} disabled={disabled} onSave={onSave} onDirtyChange={setDirty} />
    <LlmProbeControls revision={value} disabled={disabled} modelDisabled={dirty || !value}
      onModels={setRemoteModels} run={(mode) => probeSavedLlm(target, mode)} />
  </div>;
}
