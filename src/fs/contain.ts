import type { FileOp } from '../manifest/types';
import {
	dirname as dirnameNative,
	isAbsolute as isAbsoluteNative,
	posix,
	relative as relativeNative,
	resolve as resolveNative,
	sep as sepNative,
	win32,
} from 'node:path';

// The slice of node:path's API the composition and comparison below need, so
// the same logic runs once against path.posix and once against path.win32
// instead of being hand-duplicated per flavor. A hand-duplicated version is
// how a mixed-flavor guard gets in: win32 semantics for `rename`, posix for
// `dest`, each correct alone and neither catching what the other would.
interface PathFlavor {
	resolve: (...paths: string[]) => string;
	dirname: (path: string) => string;
	relative: (from: string, to: string) => string;
	isAbsolute: (path: string) => boolean;
	sep: string;
}

const NATIVE: PathFlavor = {
	resolve: resolveNative,
	dirname: dirnameNative,
	relative: relativeNative,
	isAbsolute: isAbsoluteNative,
	sep: sepNative,
};

export interface ContainmentCheck {
	contained: boolean;
	// The native-resolved absolute destination — what copyFileOp would
	// actually write to on this host — for a caller to name in its rejection
	// message. Resolved separately from the posix/win32 verdict below so the
	// message reads naturally on whichever platform the check runs.
	destination: string;
}

// The one place containment is decided. Both the validate-time guard
// (validate-unit.ts) and the write-time guard (copy.ts) call this with their
// own root and the raw file op — neither resolves a path itself and hands it
// over, because the resolving is where every escape shape lives (the
// dest/rename asymmetry, the posix/win32 split), not just the comparing.
export function checkContainment(root: string, op: FileOp): ContainmentCheck {
	return {
		contained: isContainedUnder(posix, root, op) && isContainedUnder(win32, root, op),
		destination: resolveDestination(NATIVE, root, op),
	};
}

// Mirrors resolvePaths in src/fs/copy.ts. `dest` is authored posix-style, so
// it is always split on posix.sep regardless of which flavor is resolving,
// then joined under that flavor — this is what re-roots a posix-absolute
// `dest` under `root` while leaving a Windows drive-absolute or UNC `dest`
// to escape under win32. `rename` then replaces just the basename and is
// passed through whole rather than split: it is where an absolute escape
// gets in, because resolving an absolute segment discards everything to its
// left, `root` included.
function resolveDestination(flavor: PathFlavor, root: string, op: FileOp): string {
	const destBase = flavor.resolve(root, ...op.dest.split(posix.sep));
	return op.rename ? flavor.resolve(flavor.dirname(destBase), op.rename) : destBase;
}

function isContainedUnder(flavor: PathFlavor, root: string, op: FileOp): boolean {
	// `root` arrives in whatever style its caller wrote it (validate-unit.ts's
	// notional root is posix-style; a real targetDir is native, which is
	// posix-style on macOS/Linux). Resolving it through the flavor first is
	// what keeps the boundary compare below on the same separator style as
	// `resolved` — comparing a raw posix `root` against a win32-resolved
	// `resolved` (backslash-separated) made every boundary check fail, since
	// neither string's separators ever matched the other's.
	const normalizedRoot = flavor.resolve(root);
	const resolved = resolveDestination(flavor, normalizedRoot, op);

	// Test 1: the flavor-relative path must not itself come back absolute.
	// win32.relative('C:\\proj', '\\\\server\\share\\evil.txt') hands back the
	// UNC path unchanged rather than a '..'-prefixed path, so a guard that
	// only checks for a '..' prefix misses it. A relative() result that is
	// itself absolute means `resolved` sits on a different root entirely (a
	// different drive or share), which is never contained no matter what a
	// string comparison against `root` would say.
	if (flavor.isAbsolute(flavor.relative(normalizedRoot, resolved)))
		return false;

	// Test 2: a separator-boundary compare, not a bare
	// `resolved.startsWith(root)` — that alone accepts a sibling directory
	// whose name merely extends the root's (`<root>EVIL/x` is not inside
	// `<root>`).
	const boundary = normalizedRoot.endsWith(flavor.sep) ? normalizedRoot : `${normalizedRoot}${flavor.sep}`;
	return resolved === normalizedRoot || resolved.startsWith(boundary);
}
