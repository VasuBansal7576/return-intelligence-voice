#!/bin/zsh
# Run personally in a local terminal. Never paste secret values into chat.
set -eu
[[ -t 0 ]] || { print -u2 'Direct terminal entry is required.'; exit 1; }
umask 077
mkdir -p .private
[[ ! -e .private/server.env ]] || { print -u2 'An existing private environment is present. Preserve it; edit personally rather than overwrite.'; exit 1; }
print 'Enter server credentials directly here. Input is hidden; nothing is sent to a provider.'
print 'Voice stays disabled and approved usage stays zero until credits and a durable budget are verified.'
read -rs 'assemblyaiKey?AssemblyAI server API key (hidden): '; print
read -r 'supabaseUrl?Supabase project URL (https://PROJECT.supabase.co): '
read -rs 'supabaseKey?Supabase server secret key (hidden): '; print
[[ "$assemblyaiKey" =~ '^[A-Za-z0-9_-]+$' ]] || { print -u2 'Unexpected API-key format; no file written.'; exit 1; }
[[ "$supabaseUrl" =~ '^https://[A-Za-z0-9-]+\.supabase\.co/?$' ]] || { print -u2 'Expected the official HTTPS project URL; no file written.'; exit 1; }
[[ "$supabaseKey" =~ '^[A-Za-z0-9_.-]+$' ]] || { print -u2 'Unexpected server-key format; no file written.'; exit 1; }
{
 printf 'ASSEMBLYAI_API_KEY=%s\n' "$assemblyaiKey"
 printf 'SUPABASE_URL=%s\n' "$supabaseUrl"
 printf 'SUPABASE_SECRET_KEY=%s\n' "$supabaseKey"
 printf 'RIV_VOICE_APPROVED=false\nRIV_PUBLIC_VOICE_APPROVED=false\nRIV_MAX_RESERVED_VOICE_SECONDS=0\nRIV_STORAGE=local\nRIV_PRIVATE_REPLAY_ENABLED=false\n'
} > .private/server.env
unset assemblyaiKey supabaseKey supabaseUrl
chmod 600 .private/server.env
print 'Saved private server configuration with mode 600. Voice disabled; budget zero. Do not share or screenshot this file.'
