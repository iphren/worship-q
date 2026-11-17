// What the screenshots show: hymns and a Bible passage that are in the public domain, and a
// sermon deck and a video item written for them, so the pictures can be published anywhere.
// Keep it that way: no song or Bible version under copyright, and no real church's name.

import type { Passage } from '@worship-q/bible';

export interface Hymn {
  title: string;
  author: string;
  year: number;
  /** Sections separated by a blank line; every two lines make one slide by default. */
  lyrics: string;
}

export const HYMNS: Hymn[] = [
  {
    title: 'Amazing Grace',
    author: 'John Newton',
    year: 1779,
    lyrics: `Amazing grace! How sweet the sound
That saved a wretch like me!
I once was lost, but now am found;
Was blind, but now I see.

’Twas grace that taught my heart to fear,
And grace my fears relieved;
How precious did that grace appear
The hour I first believed.

Through many dangers, toils and snares,
I have already come;
’Tis grace hath brought me safe thus far,
And grace will lead me home.

The Lord has promised good to me,
His word my hope secures;
He will my shield and portion be,
As long as life endures.`,
  },
  {
    title: 'Holy, Holy, Holy',
    author: 'Reginald Heber',
    year: 1826,
    lyrics: `Holy, holy, holy! Lord God Almighty!
Early in the morning our song shall rise to Thee;
Holy, holy, holy! Merciful and mighty!
God in three Persons, blessèd Trinity!

Holy, holy, holy! All the saints adore Thee,
Casting down their golden crowns around the glassy sea;
Cherubim and seraphim falling down before Thee,
Which wert, and art, and evermore shalt be.

Holy, holy, holy! Though the darkness hide Thee,
Though the eye of sinful man Thy glory may not see,
Only Thou art holy; there is none beside Thee,
Perfect in power, in love and purity.`,
  },
  {
    title: 'Come, Thou Fount of Every Blessing',
    author: 'Robert Robinson',
    year: 1758,
    lyrics: `Come, Thou Fount of every blessing,
Tune my heart to sing Thy grace;
Streams of mercy, never ceasing,
Call for songs of loudest praise.

Here I raise my Ebenezer;
Hither by Thy help I’m come;
And I hope, by Thy good pleasure,
Safely to arrive at home.

O to grace how great a debtor
Daily I’m constrained to be!
Let Thy goodness, like a fetter,
Bind my wandering heart to Thee.`,
  },
  {
    title: 'It Is Well with My Soul',
    author: 'Horatio Spafford',
    year: 1873,
    lyrics: `When peace like a river attendeth my way,
When sorrows like sea billows roll;
Whatever my lot, Thou hast taught me to say,
It is well, it is well with my soul.

It is well with my soul,
It is well, it is well with my soul.

My sin, oh, the bliss of this glorious thought!
My sin, not in part but the whole,
Is nailed to the cross, and I bear it no more,
Praise the Lord, praise the Lord, O my soul!`,
  },
  {
    title: 'Crown Him with Many Crowns',
    author: 'Matthew Bridges',
    year: 1851,
    lyrics: `Crown Him with many crowns,
The Lamb upon His throne;
Hark! How the heavenly anthem drowns
All music but its own.

Awake, my soul, and sing
Of Him who died for thee,
And hail Him as thy matchless King
Through all eternity.`,
  },
  {
    title: 'Be Thou My Vision',
    author: 'Words: Dallán Forgaill; Translator: Mary Byrne, Eleanor Hull',
    year: 1912,
    lyrics: `Be Thou my vision, O Lord of my heart;
Naught be all else to me, save that Thou art;
Thou my best thought, by day or by night,
Waking or sleeping, Thy presence my light.

Be Thou my wisdom, and Thou my true word;
I ever with Thee and Thou with me, Lord;
Thou my great Father, and I Thy true son;
Thou in me dwelling, and I with Thee one.`,
  },
  {
    title: 'All Creatures of Our God and King',
    author: 'Words: Francis of Assisi; Translator: William Draper',
    year: 1919,
    lyrics: `All creatures of our God and King,
Lift up your voice and with us sing,
Alleluia! Alleluia!
Thou burning sun with golden beam,
Thou silver moon with softer gleam!

O praise Him! O praise Him!
Alleluia! Alleluia! Alleluia!`,
  },
];

const line = (text: string, indent = 0) => ({ text, indent });

/** Psalm 23 in the Berean Standard Bible (public domain) and the King James Version. */
export const PSALM_23: Passage = {
  reference: 'PSA.23',
  texts: [
    {
      version: 'BSB',
      credit: 'BSB',
      provider: 'freeuse',
      copyright: 'Berean Standard Bible. Public domain.',
      fumsToken: null,
      units: [
        { chapter: 23, verses: [], label: '', title: true, lines: [line('A Psalm of David.')] },
        {
          chapter: 23,
          verses: [1],
          label: '1',
          lines: [line('The LORD is my shepherd;'), line('I shall not want.', 1)],
        },
        {
          chapter: 23,
          verses: [2],
          label: '2',
          lines: [
            line('He makes me lie down in green pastures;'),
            line('He leads me beside quiet waters.', 1),
          ],
        },
        {
          chapter: 23,
          verses: [3],
          label: '3',
          lines: [
            line('He restores my soul;'),
            line('He guides me in the paths of righteousness', 1),
            line('for the sake of His name.', 1),
          ],
        },
        {
          chapter: 23,
          verses: [4],
          label: '4',
          lines: [
            line('Even though I walk through the valley of the shadow of death,'),
            line('I will fear no evil,', 1),
            line('for You are with me;'),
            line('Your rod and Your staff, they comfort me.', 1),
          ],
        },
        {
          chapter: 23,
          verses: [5],
          label: '5',
          lines: [
            line('You prepare a table before me'),
            line('in the presence of my enemies.', 1),
            line('You anoint my head with oil;'),
            line('my cup overflows.', 1),
          ],
        },
        {
          chapter: 23,
          verses: [6],
          label: '6',
          lines: [
            line('Surely goodness and mercy will follow me'),
            line('all the days of my life,', 1),
            line('and I will dwell in the house of the LORD'),
            line('forever.', 1),
          ],
        },
      ],
    },
    {
      version: 'KJV',
      credit: 'KJV',
      provider: 'freeuse',
      copyright: 'King James Version. Public domain.',
      fumsToken: null,
      units: [
        { chapter: 23, verses: [], label: '', title: true, lines: [line('A Psalm of David.')] },
        {
          chapter: 23,
          verses: [1],
          label: '1',
          lines: [line('The LORD is my shepherd; I shall not want.')],
        },
        {
          chapter: 23,
          verses: [2],
          label: '2',
          lines: [
            line(
              'He maketh me to lie down in green pastures: he leadeth me beside the still waters.',
            ),
          ],
        },
        {
          chapter: 23,
          verses: [3],
          label: '3',
          lines: [
            line(
              'He restoreth my soul: he leadeth me in the paths of righteousness for his name’s sake.',
            ),
          ],
        },
        {
          chapter: 23,
          verses: [4],
          label: '4',
          lines: [
            line(
              'Yea, though I walk through the valley of the shadow of death, I will fear no evil: for thou art with me; thy rod and thy staff they comfort me.',
            ),
          ],
        },
        {
          chapter: 23,
          verses: [5],
          label: '5',
          lines: [
            line(
              'Thou preparest a table before me in the presence of mine enemies: thou anointest my head with oil; my cup runneth over.',
            ),
          ],
        },
        {
          chapter: 23,
          verses: [6],
          label: '6',
          lines: [
            line(
              'Surely goodness and mercy shall follow me all the days of my life: and I will dwell in the house of the LORD for ever.',
            ),
          ],
        },
      ],
    },
  ],
};

/** One slide of a sermon deck, drawn as an image by media.ts. */
export interface SermonSlide {
  /** The large line; the title on the first slide. */
  heading: string;
  /** Smaller lines under it. */
  lines: string[];
}

/** A sermon's slides, as if imported from PowerPoint. */
export interface Sermon {
  kind: 'sermon';
  title: string;
  source: string;
  slides: SermonSlide[];
}

/** A video item, as if uploaded. Only its record is made: no scene plays it. */
export interface VideoItem {
  kind: 'video';
  title: string;
  source: string;
  durationSeconds: number;
}

export const SERMON: Sermon = {
  kind: 'sermon',
  title: 'The Good Shepherd',
  source: 'The Good Shepherd.pptx',
  slides: [
    { heading: 'The Good Shepherd', lines: ['Psalm 23 · John 10:11'] },
    {
      heading: '1. He provides',
      lines: ['“The LORD is my shepherd; I shall not want.”', 'Psalm 23:1'],
    },
    { heading: '2. He restores', lines: ['“He restores my soul.”', 'Psalm 23:3'] },
    {
      heading: '3. He stays',
      lines: ['“I will fear no evil, for You are with me.”', 'Psalm 23:4'],
    },
  ],
};

export const WELCOME_VIDEO: VideoItem = {
  kind: 'video',
  title: 'Welcome',
  source: 'Welcome.mp4',
  durationSeconds: 95,
};

/**
 * The run sheet of the Sunday the screenshots show, in order: hymns by title, a passage, the
 * sermon and a video. The first four are the columns the Present page shows.
 */
export const RUN_SHEET: (string | Passage | Sermon | VideoItem)[] = [
  WELCOME_VIDEO,
  'Holy, Holy, Holy',
  PSALM_23,
  SERMON,
  'Amazing Grace',
  'It Is Well with My Soul',
];
