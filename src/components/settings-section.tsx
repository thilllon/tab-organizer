import type { ReactNode } from 'react';

interface SettingsSectionProps {
  title: string;
  description: string;
  children: ReactNode;
}

/** One boxed section of the Settings dialog, with a heading and an explanation. */
export function SettingsSection({ title, description, children }: SettingsSectionProps) {
  return (
    <section className="rounded-lg border bg-background">
      <div className="border-b px-4 py-3">
        <h2 className="text-sm font-semibold">{title}</h2>
        <p className="mt-0.5 text-xs text-muted-foreground">{description}</p>
      </div>
      <div className="space-y-5 px-4 py-4">{children}</div>
    </section>
  );
}
