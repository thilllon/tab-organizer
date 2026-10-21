import type { SiteCopy } from './site-copy';

export const en: SiteCopy = {
  meta: {
    homeTitle: 'Tab Organizer - sort, group and save your Chrome tabs',
    homeDescription:
      'A Chrome extension that sorts and groups every tab in one click, handles duplicates, and saves whole windows as sessions you can restore. Free, no account, nothing leaves your device.',
    supportTitle: 'Support - Tab Organizer',
    supportDescription:
      'Answers to common questions about Tab Organizer, and how to report a problem or ask for a feature.',
    privacyTitle: 'Privacy policy - Tab Organizer',
    privacyDescription:
      'Tab Organizer collects nothing and makes no network requests. What it stores, where, and for how long.',
    ogImageAlt: 'The Tab Organizer page with a saved session of two windows and their tab groups',
  },
  nav: {
    home: 'Home',
    main: 'Main',
    features: 'Features',
    support: 'Support',
    privacy: 'Privacy',
    language: 'Language',
    skipToContent: 'Skip to content',
    github: 'GitHub',
  },
  cta: {
    addToChrome: 'Add to Chrome',
    note: 'Free · No account · Works offline',
    seeFeatures: 'See what it does',
  },
  hero: {
    eyebrow: 'Extension for Chrome',
    title: 'One click, and every tab falls into place.',
    lead: 'Tab Organizer sorts and groups the tabs in your window, clears out duplicates, and saves whole windows as sessions you can bring back later. Everything stays on your computer.',
    imageAlt:
      'The Tab Organizer page: saved sessions in the left column, and a session of two windows with its pinned tabs and tab groups on the right',
    languages:
      'The extension itself comes in English, 한국어, Español and 日本語. It follows Chrome’s language, or the one you pick in its Settings.',
  },
  sort: {
    kicker: 'Sorting',
    title: 'Click the icon. That is the whole workflow.',
    lead: 'No popup and no menu to get through. A click on the toolbar icon sorts the window you are in, and you choose once, in Settings, how.',
    before: 'Before',
    after: 'After',
    beforeAlt:
      'A Chrome tab strip before sorting: Hacker News, YouTube, GitHub, Google and Amazon tabs in no particular order',
    afterAlt:
      'The same tab strip after one click: the tabs sorted by site, with the GitHub and Google tabs side by side in tab groups',
    points: [
      'Choose By URL, By title, or Custom, which groups by site in the order you first opened them',
      'Group by full hostname, or by domain so every Google service lands together',
      'Existing tab groups are sorted by name and tidied inside; pinned tabs stay put',
    ],
  },
  rows: [
    {
      shot: 'restore',
      kicker: 'Sessions',
      title: 'Put a project away, and get it back exactly as it was',
      body: 'Save every window from the right-click menu or the Save button, or just the one you are in with a keyboard shortcut you assign. Restoring rebuilds the tab order, pinned tabs, tab groups, the active tab and the window size.',
      points: [
        'Open a session in new windows, or add it to the window you are in',
        'Big sessions load lazily, with progress and a Cancel button',
        'Restoring never deletes the saved session',
      ],
      alt: 'Tab Organizer asking "Restore 112 tabs?" with the option to load tabs lazily, over a saved session of three windows',
    },
    {
      shot: 'history',
      kicker: 'Automatic snapshots',
      title: 'A safety net for crashes and closed windows',
      body: 'Every 5 minutes, and only when something changed, Tab Organizer keeps a snapshot of all your open windows. After Chrome restarts, the last one is marked as recovered so you can pick up where you left off.',
      points: [
        'The 20 most recent are kept by default; you choose the interval and the number',
        'Keep moves a snapshot into your saved sessions for good',
        'On by default, off in one click, and then no timer runs at all',
      ],
      alt: 'A recovered snapshot open in Tab Organizer, with three automatic snapshots listed in the left column',
    },
    {
      shot: 'search',
      kicker: 'Search',
      title: 'Find that one tab, wherever it is',
      body: 'One search box looks through your open windows and every saved session by title, address or site, best matches first. Snapshots are searched too when you ask.',
      points: [
        'Press / to search from anywhere on the page',
        'Arrow keys to move, Enter to open, Esc to clear',
        'A saved tab that is already open is switched to, not opened twice',
      ],
      alt: 'Search results for "github" in Tab Organizer, listing matching tabs from two saved sessions',
    },
    {
      shot: 'settings',
      kicker: 'Duplicates and settings',
      title: 'Duplicate tabs, handled the way you like',
      body: 'Keep one is the default: extra copies of the same page are closed, keeping the one you are looking at. You can also choose Keep all, or Group them to collect the copies in a tab group to review first.',
      points: [
        'Every setting saves as you change it, no Save button',
        'Advanced options for pinned and suspended tabs stay out of the way',
        'Closed a duplicate by mistake? Ctrl+Shift+T brings it back',
      ],
      alt: 'The Tab Organizer settings dialog: Sort by set to By URL, Duplicate tabs set to Keep one, and Automatic snapshots switched on',
    },
  ],
  more: {
    title: 'And the rest of the toolkit',
    lead: 'Small things that make a big tab habit easier to live with.',
    cards: [
      {
        icon: 'assemble',
        title: 'Assemble!',
        body: 'Pull the tabs of every other window into the one you are using. Tabs are moved, never reopened, so groups, history and anything you typed survive.',
      },
      {
        icon: 'transfer',
        title: 'Import and export',
        body: 'JSON that imports back exactly, Markdown, plain text, CSV, or HTML bookmarks for Chrome. Import a file or paste a list of links, with a preview first.',
      },
      {
        icon: 'keyboard',
        title: 'Keyboard shortcuts',
        body: 'Sort with Alt+Shift+S and Assemble! with Alt+Shift+A (Option on a Mac). Saving a session and opening Tab Organizer can have keys of their own.',
      },
      {
        icon: 'grouping',
        title: 'Works with what you use',
        body: 'Tabs suspended by The Marvellous Suspender sort by their real address. Name your tab groups 1-Work, 2-Reading to set their order.',
      },
    ],
  },
  promise: {
    title: 'Your tabs never leave your computer',
    lead: 'Tab Organizer has no server to send anything to. It works the same with the network unplugged.',
    points: [
      {
        title: 'Stays on the device',
        body: 'Sessions and snapshots live in Chrome’s local extension storage. They are not synced and not uploaded.',
      },
      {
        title: 'No account',
        body: 'Nothing to sign up for and nothing to sign in to. Install it and click.',
      },
      {
        title: 'No network',
        body: 'No analytics, no tracking, no requests of any kind. Nothing is read from or injected into the pages you visit.',
      },
    ],
    link: 'Read the privacy policy',
  },
  closing: {
    title: 'Give your tabs one click',
    lead: 'Free on the Chrome Web Store. Works in Chrome 123 or newer, and should work in Edge and Brave too.',
  },
  support: {
    title: 'Support',
    lead: 'Answers to the questions people ask most, and how to reach us when something is not right.',
    startTitle: 'Getting started',
    startSteps: [
      'Add Tab Organizer from the Chrome Web Store, then pin its icon to the toolbar.',
      'Click the icon to sort the window you are in.',
      'Right-click the icon for Assemble! and Save all windows as session. Options opens Tab Organizer itself, with your sessions and settings.',
    ],
    reportTitle: 'Report a problem',
    reportLead:
      'Found a bug or missing a feature? Open an issue on GitHub. We read every report. It helps to include:',
    reportItems: [
      'your Chrome version (chrome://version) and the Tab Organizer version',
      'what you did, what you expected, and what happened instead',
      'a screenshot, if the problem is something you can see',
    ],
    reportButton: 'Open an issue on GitHub',
    openIssues: 'See existing issues',
    versionTitle: 'Current version',
    versionText: 'The latest release is version {version}.',
    releases: 'Release notes',
    requirement: 'Requires Chrome 123 or newer.',
    faqTitle: 'Frequently asked questions',
    faq: [
      {
        q: 'Does it sort every window at once?',
        a: 'Sorting works on the window you are in, so click the icon in each window you want to tidy. To bring every window together first, use Assemble! from the right-click menu. Sessions can cover all windows at once.',
      },
      {
        q: 'Will it mess up my pinned tabs?',
        a: 'No. Pinned tabs are left alone by default. If you want them sorted too, turn that on under Advanced in Settings.',
      },
      {
        q: 'Does it send my browsing data anywhere?',
        a: 'No. Tab Organizer makes no network requests at all. Everything happens inside your browser.',
      },
      {
        q: 'Where are my saved sessions stored?',
        a: 'In Chrome’s local extension storage on this device only. They are never synced, uploaded or shared with web pages. Delete one session, or all session data, whenever you like; uninstalling removes everything. Export to JSON to keep a backup of your own.',
      },
      {
        q: 'What do automatic snapshots record, and can I turn them off?',
        a: 'A snapshot holds the same data as a saved session: addresses, titles, pinned tabs, tab groups and window layout. One is taken every 5 minutes (you can change that) when something changed, and when you click the icon to sort. The 20 most recent are kept by default (you choose how many), plus any you protect. Switch snapshots off in Settings and no timer runs at all.',
      },
      {
        q: 'How do I restore a session?',
        a: 'Right-click the icon and choose Options (or use your shortcut), pick the session in the left column and press Open. Windows come back with their order, pinned tabs, tab groups and active tab. Open here adds a saved window to the one you are in instead.',
      },
      {
        q: 'Can I move my sessions to another computer?',
        a: 'Yes. Export everything as JSON and import that file on the other computer, or export as HTML and import it into Chrome’s bookmarks.',
      },
      {
        q: 'What if I do not like the result of a sort?',
        a: 'Sorting only moves tabs, so nothing is lost. A closed duplicate comes back with Ctrl+Shift+T (Cmd+Shift+T on a Mac).',
      },
      {
        q: 'Does it work in other Chromium browsers?',
        a: 'It needs Chrome 123 or newer and should work in any Chromium browser of that age with tab groups, including Microsoft Edge and Brave.',
      },
    ],
  },
  privacyPage: {
    notice: 'This English text is the authoritative version of the privacy policy.',
    englishLink: '',
  },
  footer: {
    tagline: 'Sort, group and save your tabs. Nothing leaves your device.',
    languages: 'Languages',
  },
};
