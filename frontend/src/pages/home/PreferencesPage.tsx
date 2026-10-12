import { useState } from "react";

import { useAuth } from "@/auth/AuthContext";
import { Button, Callout, Card, Field, FormError, PageHeader, toast } from "@/components/ui";
import { useApiMutation } from "@/lib/hooks";

const DEFAULTS = {
  landing: "/home",
  digest: "Daily / 09:00 IST",
  density: "Comfortable",
  work_review_alerts: "In-app + email",
  training_reminders: "7 days and 1 day before due",
  keyboard_shortcuts: true,
};

export function PreferencesPage() {
  const { account } = useAuth();
  const [prefs, setPrefs] = useState({ ...DEFAULTS, ...(account?.preferences ?? {}) });
  const save = useApiMutation<typeof prefs>("put", "/auth/preferences");
  const set = (k: keyof typeof DEFAULTS, v: string | boolean) => setPrefs({ ...prefs, [k]: v });

  return (
    <>
      <PageHeader title="Your workspace preferences" sub="Personal preferences apply to your named account" />
      <div className="grid grid-main">
        <Card>
          <FormError error={save.error} />
          <div className="form-grid">
            <Field label="Default landing view" required>
              <select className="input" value={prefs.landing as string} onChange={(e) => set("landing", e.target.value)}>
                <option value="/home">Home</option>
                <option value="/tasks">Tasks</option>
                <option value="/projects">Projects</option>
              </select>
            </Field>
            <Field label="Time zone" required>
              <input className="input" value="Asia/Kolkata / IST" readOnly />
            </Field>
            <Field label="Notification digest" required>
              <select className="input" value={prefs.digest as string} onChange={(e) => set("digest", e.target.value)}>
                <option>Daily / 09:00 IST</option>
                <option>Weekly / Monday 09:00 IST</option>
                <option>Off</option>
              </select>
            </Field>
            <Field label="Display density" required>
              <select className="input" value={prefs.density as string} onChange={(e) => set("density", e.target.value)}>
                <option>Comfortable</option>
                <option>Compact</option>
              </select>
            </Field>
            <Field label="Work review alerts" required>
              <select className="input" value={prefs.work_review_alerts as string} onChange={(e) => set("work_review_alerts", e.target.value)}>
                <option>In-app + email</option>
                <option>In-app only</option>
              </select>
            </Field>
            <Field label="Training reminders" required>
              <select className="input" value={prefs.training_reminders as string} onChange={(e) => set("training_reminders", e.target.value)}>
                <option>7 days and 1 day before due</option>
                <option>1 day before due</option>
                <option>Off</option>
              </select>
            </Field>
            <Field label="Date display">
              <input className="input" value="09 Oct 2026" readOnly />
            </Field>
            <label className="check">
              <input type="checkbox" checked={!!prefs.keyboard_shortcuts} onChange={(e) => set("keyboard_shortcuts", e.target.checked)} /> Keyboard shortcuts enabled
            </label>
          </div>
          <div className="row between mt">
            <Button onClick={() => setPrefs({ ...DEFAULTS, ...(account?.preferences ?? {}) })}>Cancel</Button>
            <Button variant="primary" disabled={save.isPending} onClick={() => save.mutate(prefs, { onSuccess: () => toast("Preferences saved") })}>
              Save preferences
            </Button>
          </div>
        </Card>
        <div className="stack">
          <Callout title="Search anywhere">Ctrl K opens projects, tasks and people within your allowed scope.</Callout>
          <Callout title="Stay in context">Global search opens the same record from any main screen.</Callout>
          <Callout title="Notifications">Read / unread and notification preferences do not approve work or training.</Callout>
        </div>
      </div>
    </>
  );
}
