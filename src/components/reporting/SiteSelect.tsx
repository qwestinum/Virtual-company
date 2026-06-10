'use client';

/**
 * Liste déroulante de sites avec recherche (filtre Reporting). Construit sur
 * la primitive `SearchableSelect`. Option « Tous » par défaut.
 */

import {
  SearchableSelect,
  type SelectOption,
} from '@/components/reporting/SearchableSelect';

export type SiteOption = SelectOption;

export function SiteSelect({
  options,
  value,
  onChange,
}: {
  options: SiteOption[];
  value: string;
  onChange: (id: string) => void;
}) {
  return (
    <SearchableSelect
      label="Site"
      options={options}
      value={value}
      onChange={onChange}
    />
  );
}
