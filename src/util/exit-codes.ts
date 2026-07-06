// The whole exit vocabulary, in one citable place — AGENTS.md documents these
// three as the contract, so a new code (or a drifted meaning) should have to
// change this file and that document together, not sneak in as a bare literal.
//
// Success includes answering "No" at a confirm and clean reports that found
// things: doctor with findings and outdated with stale pins both exit 0 unless
// --strict opts into gating.
export const EXIT_OK = 0;

// Errors of every stripe: bad input, failed detection, an apply that failed,
// and the --strict gates.
export const EXIT_ERROR = 1;

// Ctrl-C at a prompt: 128 + SIGINT(2), the shell convention, so scripts can
// tell a user abort from a clean finish or a real error.
export const EXIT_CANCELLED = 130;
