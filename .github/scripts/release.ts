import { $ } from 'bun';
import { env } from 'node:process';

const tested = env.TESTED_SHA;
if (!tested) throw new Error('Missing TESTED_SHA');

const head = (await $`git rev-parse HEAD`.text()).trim();
if (head !== tested) {
	console.log(`master is at ${head}, past the commit CI tested (${tested}). A later CI run releases what is pending.`);
	process.exit(0);
}

const pending = (await $`git ls-files .changeset`.text())
	.split('\n')
	.filter(path => /^\.changeset\/.+\.md$/.test(path));
if (pending.length) await $`bunx changeset version`;

const { name, version } = await Bun.file('package.json').json();
// npm answers an unknown version with nothing, and a package it has never seen with E404.
const published = (await $`npm view ${`${name}@${version}`} version`.nothrow().quiet().text()).trim() === version;
// Publishing before pushing lets a rerun converge: a version npm already has is skipped, and its commit is pushed.
if (published) console.log(`${name}@${version} is already on npm.`);
else {
	const publish = await $`npm publish`.nothrow();
	// npm holds a new version back for a few minutes, during which `npm view` cannot see it. A run in that window
	// publishes it again and npm answers 409, which means the version is there.
	if (publish.exitCode !== 0 && !/Cannot publish over/.test(publish.stderr.toString())) process.exit(publish.exitCode);
}

if (pending.length) {
	await $`git add --all .changeset package.json CHANGELOG.md`;
	await $`git -c user.name=${'github-actions[bot]'} -c user.email=${'41898282+github-actions[bot]@users.noreply.github.com'} commit -m ${`chore(release): ${name}@${version}`}`;
	const push = await $`git push origin HEAD:master`.nothrow();
	if (push.exitCode !== 0)
		console.log(`master moved while releasing ${version}. The next CI run on master commits the version again.`);
}
