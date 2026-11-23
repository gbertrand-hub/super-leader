import {getCountryOptions} from "@/lib/countries";

type CountrySelectProps = {
  name: string;
  locale: "fr" | "en";
  className?: string;
  defaultValue?: string | null;
  required?: boolean;
  id?: string;
  emptyLabel?: string;
};

export function CountrySelect({
  name,
  locale,
  className,
  defaultValue,
  required = false,
  id,
  emptyLabel,
}: CountrySelectProps) {
  const options = getCountryOptions(locale);
  const selected = defaultValue?.trim() ?? "";
  const selectedExists = selected.length === 0 || options.some((country) => country.value === selected);

  return (
    <select name={name} id={id} required={required} defaultValue={selected} className={className}>
      <option value="">{emptyLabel ?? (locale === "fr" ? "Sélectionner un pays" : "Select a country")}</option>
      {!selectedExists ? <option value={selected}>{selected}</option> : null}
      {options.map((country) => (
        <option key={country.code} value={country.value}>
          {locale === "fr" ? country.fr : country.en}
        </option>
      ))}
    </select>
  );
}
