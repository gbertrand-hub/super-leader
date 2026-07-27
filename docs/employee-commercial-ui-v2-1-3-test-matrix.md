# Super Leader V2.1.3 - Test Matrix

## Employee

- Navigation shows `Mon planning` / `My schedule`, never the translation key.
- Sales subtitle says the employee records and follows their own sales.
- Sales buttons display `Mes dossiers de recouvrement` and `Exporter mes ventes (CSV)`.
- Collections subtitle states that only assigned cases are shown.
- CRM customer profile displays sales owner and follow-up owner as read-only cards.
- New CRM contract displays both ownership fields as read-only cards.
- Direct form tampering cannot assign another user or clear ownership.

## Manager

- Sales and Collections retain management wording.
- CRM assignment lists remain available but contain only users in the manager's authorised scope.

## Owner / Admin

- Full assignment controls remain available.
- Global Sales and Collections wording remains unchanged.

## Security

- Employee-owned CRM updates force `owner_id` and `follow_up_owner_id` to the authenticated user.
- Employee-created CRM contracts force `seller_id` and `collection_owner_id` to the authenticated user.
