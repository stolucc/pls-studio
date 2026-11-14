-- TOTP hardening: a code is accepted once (the time step of the last accepted
-- code is kept; RFC 6238 section 5.2), and the second step after Google
-- sign-in counts failures like a wrong password (failed_logins / locked_until).
ALTER TABLE users ADD COLUMN totp_last_step bigint;
