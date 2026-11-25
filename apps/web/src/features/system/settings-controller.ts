export interface SettingsSectionController {
  dirty: boolean;
  valid: boolean;
  pending: boolean;
  apply: () => Promise<void>;
  reset: () => void;
}

export type RegisterSettingsSection = (
  id: string,
  controller: SettingsSectionController | null,
) => void;
