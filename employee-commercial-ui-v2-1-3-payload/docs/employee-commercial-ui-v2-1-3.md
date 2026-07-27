# Super Leader V2.1.3 - Employee Commercial UI & CRM Ownership Lock

## Objective

Align the Sales, Collections and CRM interfaces with the Employee role while enforcing ownership rules on the server.

## Changes

- The navigation label now displays `Mon planning` in French and `My schedule` in English.
- The Sales header, collection link and CSV export label are adapted to the Employee role.
- The Collections introduction explains that an employee sees only assigned cases.
- CRM client and contract owner fields are read-only for an Employee.
- The Employee is automatically assigned as both sales owner and follow-up owner.
- Server actions ignore any forged owner identifiers submitted by an Employee and force the authenticated user ID.
- Owner, Admin and Manager assignment controls remain unchanged.

## Database impact

No Supabase migration is required.
