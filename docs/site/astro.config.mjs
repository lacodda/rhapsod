// @ts-check
import { defineConfig } from 'astro/config';
import starlight from '@astrojs/starlight';

// https://astro.build/config
export default defineConfig({
	site: 'https://lacodda.github.io',
	base: '/rhapsod',
	integrations: [
		starlight({
			title: 'rhapsod',
			description: 'A self-hosted reader for a markdown library: progress, notes and spaced repetition.',
			favicon: '/favicon.svg',
			customCss: ['./src/styles/brand.css'],
			social: [{ icon: 'github', label: 'GitHub', href: 'https://github.com/lacodda/rhapsod' }],
			editLink: {
				baseUrl: 'https://github.com/lacodda/rhapsod/edit/main/docs/site/',
			},
			sidebar: [
				{ label: 'Getting Started', slug: 'getting-started' },
				{
					label: 'Guides',
					items: [{ autogenerate: { directory: 'guides' } }],
				},
				{
					label: 'Reference',
					items: [{ autogenerate: { directory: 'reference' } }],
				},
				{
					label: 'Concepts',
					items: [{ autogenerate: { directory: 'concepts' } }],
				},
			],
		}),
	],
});
