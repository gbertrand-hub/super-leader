"use client";

import { useState } from "react";
import { uploadAcademyStudentPhotoAction } from "@/app/actions/academy-student-photo";

export function StudentPhotoUpload({
  clientId,
  hasPhoto,
}: {
  clientId: string;
  hasPhoto: boolean;
}) {
  const [fileName, setFileName] = useState("");

  return (
    <form
      action={uploadAcademyStudentPhotoAction}
      className="flex flex-wrap justify-end gap-2"
    >
      <input type="hidden" name="crm_client_id" value={clientId} />
      <label className="flex min-w-52 cursor-pointer items-center justify-center rounded-xl border bg-white px-4 py-2 text-xs font-bold text-slate-700 hover:bg-slate-50">
        <span className="max-w-56 truncate">
          {fileName || "Choisir une photo"}
        </span>
        <input
          type="file"
          name="photo"
          accept="image/png,image/jpeg,image/webp"
          required
          className="sr-only"
          onChange={(event) => setFileName(event.target.files?.[0]?.name ?? "")}
        />
      </label>
      <button className="rounded-xl bg-slate-950 px-4 py-2 text-xs font-black text-white disabled:opacity-50">
        {hasPhoto ? "Remplacer la photo" : "Téléverser la photo"}
      </button>
    </form>
  );
}
