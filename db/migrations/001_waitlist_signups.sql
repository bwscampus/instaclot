-- Waitlist signups. Name and email are stored only as AES-256-GCM ciphertext (DB-9);
-- email_bidx is an HMAC blind index that keeps one signup per address without storing it.
create table waitlist_signups (
    id bigint generated always as identity primary key,
    email_bidx text not null unique,
    email_ciphertext text not null,
    name_ciphertext text not null,
    created_at timestamptz not null default now()
);
