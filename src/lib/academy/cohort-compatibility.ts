/** A promotion cohort belongs to a school. Its program_id may point to the
 * historical/staff program while ordinary students follow a different course
 * program in the same promotion. Do not treat that reference as an exclusive
 * enrollment constraint; existing Academy data already shares such cohorts.
 */
export type AcademyCohortSelection = {
  school_id: string;
  status: string | null;
  program_id?: string | null;
};
export type AcademyProgramSelection = {
  school_id: string;
  status: string | null;
};
export function canEnrollInSchoolCohort(
  schoolId: string,
  program: AcademyProgramSelection | null | undefined,
  cohort: AcademyCohortSelection | null | undefined,
): boolean {
  return Boolean(
    schoolId &&
      program?.school_id === schoolId &&
      cohort?.school_id === schoolId &&
      program?.status === "active" &&
      cohort?.status === "active",
  );
}
