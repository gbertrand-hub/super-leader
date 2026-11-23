"use client";

import {useMemo, useState} from "react";
import {TimeZoneSelect} from "@/components/forms/time-zone-select";

type MemberOption = {
  id: string;
  name: string;
  timeZone: string;
};

type Props = {
  members: MemberOption[];
  defaultTimeZone: string;
  locale: "fr" | "en";
  fieldClassName: string;
  employeeLabel: string;
  timeZoneLabel: string;
};

export function MemberTimeZoneFields({
  members,
  defaultTimeZone,
  locale,
  fieldClassName,
  employeeLabel,
  timeZoneLabel,
}: Props) {
  const [selectedUserId, setSelectedUserId] = useState(members[0]?.id ?? "");
  const selectedTimeZone = useMemo(
    () => members.find((member) => member.id === selectedUserId)?.timeZone || defaultTimeZone,
    [defaultTimeZone, members, selectedUserId],
  );

  return <>
    <label className="block text-sm font-black">
      {employeeLabel}
      <select
        name="userId"
        value={selectedUserId}
        onChange={(event) => setSelectedUserId(event.target.value)}
        className={fieldClassName}
      >
        {members.map((member) => <option key={member.id} value={member.id}>{member.name}</option>)}
      </select>
    </label>
    <div className="block text-sm font-black">
      <p>{timeZoneLabel}</p>
      <TimeZoneSelect
        key={`${selectedUserId}:${selectedTimeZone}`}
        name="timezone"
        defaultValue={selectedTimeZone}
        locale={locale}
        className={fieldClassName}
      />
      <p className="mt-1 text-xs font-semibold text-indigo-700">
        {locale === "fr"
          ? "Le fuseau du profil de l’employé est proposé automatiquement."
          : "The employee profile time zone is selected automatically."}
      </p>
    </div>
  </>;
}
