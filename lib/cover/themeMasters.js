/**
 * TwinkleTale AI — Theme Master Constitutions (12 Themes)
 * Establishes the visual identity, palette, child hero spotlight role,
 * environmental framing, and negative-space rules for ultra-premium covers.
 */

const THEME_MASTERS = {
    'space-and-stars': {
        themeKey: 'space-and-stars',
        themeName: 'Space & Stars',
        visualNorthStar: 'A breathtaking, luminous cosmic storybook world with soft swirling nebulae, gentle floating star clusters, and deep velvety indigo horizons.',
        coverMood: 'Awe-inspiring, magical, cozy wonder, tranquil bedtime starlight.',
        palette: {
            primary: '#0d1b2a',
            accent: '#f6d365',
            accentAlt: '#fda085',
            background: '#0a0f1d',
            text: '#ffffff',
            scrim: 'rgba(10, 15, 29, 0.75)'
        },
        childRole: 'A curious young cosmic explorer wearing a cozy, whimsical celestial suit with glowing starlight embroidery and soft boots.',
        heroAction: 'holding a gently glowing star in both hands, gazing up with soulful sparkling eyes, or reaching toward a radiant friendly constellation.',
        heroFocalArea: 'occupies 60% to 65% of the central and lower canvas, naturally illuminated by warm starlight.',
        lighting: 'Warm golden volumetric rim lighting on the child\'s face and hair, soft celestial glow from the star, cinematic depth.',
        texture: 'Rich digital gouache, soft oil pastel textures, luminous magical dust, no flat 2D cartoon, no plastic 3D CGI.',
        environmentalFraming: 'Gentle arching bands of distant milky-way stardust and soft floating pastel nebulae framing the upper scene.',
        negativeSpacePreference: 'The top 30-35% of the cover is a tranquil, uncluttered deep twilight sky reserved exclusively for title typography.',
        allowedMotifs: ['glowing starbursts', 'crescent moon sliver', 'tiny pastel planets', 'soft stardust trails', 'friendly cosmic fireflies'],
        forbiddenMotifs: ['aggressive laser beams', 'mechanical spaceship interiors', 'aliens with scary teeth', 'black holes', 'dark horror imagery'],
        compatibleArchetypes: ['HERO_SCENE', 'EDITORIAL_PORTRAIT', 'STORY_MOMENT', 'MAGICAL_NEGATIVE_SPACE', 'THEME_SIGNATURE']
    },

    'forest-and-animals': {
        themeKey: 'forest-and-animals',
        themeName: 'Forest & Animals',
        visualNorthStar: 'An enchanting sun-dappled woodland filled with ancient mossy oaks, glowing mushrooms, blooming wildflowers, and friendly forest companions.',
        coverMood: 'Warm, peaceful, gentle adventure, harmonious nature, comforting.',
        palette: {
            primary: '#1b4332',
            accent: '#e9c46a',
            accentAlt: '#2a9d8f',
            background: '#081c15',
            text: '#ffffff',
            scrim: 'rgba(8, 28, 21, 0.75)'
        },
        childRole: 'A gentle woodland wanderer dressed in a cozy earth-toned tunic or knit sweater with acorn buttons and soft boots.',
        heroAction: 'sitting on a mossy root gently feeding or whispering to a friendly baby deer and rabbit, beaming with joy.',
        heroFocalArea: 'occupies 60% to 65% of the central canvas, lovingly surrounded by friendly woodland animals.',
        lighting: 'Volumetric golden sunbeams filtering through leaves, gentle warm rim light, soft magical firefly motes.',
        texture: 'Lush painterly oils, soft gouache foliage, visible brushstroke warmth, rich natural textures.',
        environmentalFraming: 'Ancient overhanging oak boughs and fern fronds curving gently around the sides and top.',
        negativeSpacePreference: 'The upper third is a calm, soft forest canopy clearing with open morning sky reserved for title typography.',
        allowedMotifs: ['golden acorns', 'spotted deer', 'gentle rabbits', 'blooming bellflowers', 'glowing fireflies', 'lush moss'],
        forbiddenMotifs: ['dark thorny thickets', 'predators', 'hunting traps', 'scary shadows', 'dead trees'],
        compatibleArchetypes: ['HERO_SCENE', 'EDITORIAL_PORTRAIT', 'STORY_MOMENT', 'FRAMED_WORLD', 'MAGICAL_NEGATIVE_SPACE']
    },

    'kingdom-and-princess': {
        themeKey: 'kingdom-and-princess',
        themeName: 'Kingdom & Princesses',
        visualNorthStar: 'A fairytale storybook kingdom with soaring distant palace spires, flowering rose gardens, and a magical palace terrace.',
        coverMood: 'Regal, whimsical, elegant, warm-hearted, dreamlike, graceful.',
        palette: {
            primary: '#5c1d3f',
            accent: '#ffd166',
            accentAlt: '#f4a261',
            background: '#330a21',
            text: '#ffffff',
            scrim: 'rgba(51, 10, 33, 0.75)'
        },
        childRole: 'A brave and joyful royal hero or princess in a flowing, beautifully embroidered storybook gown or regal velvet coat with delicate gold filigree.',
        heroAction: 'smiling warmly from a sunlit castle terrace, holding a glowing magical blossom or releasing a gentle golden bird into the sky.',
        heroFocalArea: 'commanding 60% to 65% of the cover space as the undeniable protagonist.',
        lighting: 'Golden hour sunset radiance, soft fairy-tale glow, delicate specular highlights on gown and hair.',
        texture: 'Silky storybook oil painting, soft velour textures, luminous warm highlights, ornate artisan detail.',
        environmentalFraming: 'Graceful arching marble balustrades and climbing climbing heirloom rose boughs framing the scene.',
        negativeSpacePreference: 'Upper third is an expansive open rose-tinted twilight sky with soft pastel clouds for title placement.',
        allowedMotifs: ['soft heirloom roses', 'distant castle spires', 'delicate tiara glint', 'golden ribbons', 'friendly doves'],
        forbiddenMotifs: ['creepy dungeons', 'scary dragons', 'cracked stone', 'cold stone cages', 'dark villainous shadows'],
        compatibleArchetypes: ['EDITORIAL_PORTRAIT', 'HERO_SCENE', 'FRAMED_WORLD', 'THEME_SIGNATURE']
    },

    'superhero-stories': {
        themeKey: 'superhero-stories',
        themeName: 'Superhero Stories',
        visualNorthStar: 'A vibrant, uplifting heroic adventure atop a sun-drenched city tower or golden mountain crest, filled with soaring optimism and courage.',
        coverMood: 'Brave, inspiring, energetic, joyful, empowered, bright.',
        palette: {
            primary: '#1d3557',
            accent: '#f4a261',
            accentAlt: '#e63946',
            background: '#111d2e',
            text: '#ffffff',
            scrim: 'rgba(17, 29, 46, 0.75)'
        },
        childRole: 'A courageous, smiling little hero wearing a custom heroic cape and emblem suit that glows with kind, protective golden energy.',
        heroAction: 'standing in a proud, joyful dynamic pose with hands on hips or leaping lightly through starlight, beaming with confidence.',
        heroFocalArea: 'dominating 60% to 65% of the cover with bold, readable heroic silhouette.',
        lighting: 'Dramatic warm rim lighting, golden morning sunrise, luminous energy motes outlining the cape.',
        texture: 'Bold painterly brushwork with cinematic warmth, crisp fabric weave, dimensional lighting.',
        environmentalFraming: 'Golden city sunbeams and soaring cloud banks creating diagonal dynamic leading lines.',
        negativeSpacePreference: 'Upper section features an expansive golden sunrise sky tailored for bold display typography.',
        allowedMotifs: ['starburst shields', 'flowing cape', 'luminous courage sparks', 'friendly soaring skylines', 'sunbeams'],
        forbiddenMotifs: ['weapons', 'destruction', 'villains', 'fire and rubble', 'gloomy grit', 'violence'],
        compatibleArchetypes: ['HERO_SCENE', 'EDITORIAL_PORTRAIT', 'STORY_MOMENT', 'THEME_SIGNATURE']
    },

    'dinosaur-wonders': {
        themeKey: 'dinosaur-wonders',
        themeName: 'Dinosaur Wonders',
        visualNorthStar: 'A lush, sunlit prehistoric paradise of giant prehistoric ferns, glowing waterfalls, and gentle, loving baby dinosaurs.',
        coverMood: 'Adventurous, wondrous, warm, friendly discovery, ancient beauty.',
        palette: {
            primary: '#264653',
            accent: '#e76f51',
            accentAlt: '#2a9d8f',
            background: '#132329',
            text: '#ffffff',
            scrim: 'rgba(19, 35, 41, 0.75)'
        },
        childRole: 'An adventurous young naturalist explorer in a safari vest and adventurous rolled sleeves with a tiny satchel.',
        heroAction: 'gently petting a playful baby triceratops or laughing as a baby long-neck reaches down to nuzzle their shoulder.',
        heroFocalArea: 'commands 60% to 65% of the canvas together with their friendly baby dinosaur companion.',
        lighting: 'Warm amber prehistoric sunlight pouring through misty giant fern leaves, golden rim lighting.',
        texture: 'Rich gouache and oil painting, soft organic skin and scute textures, velvety foliage.',
        environmentalFraming: 'Majestic arching cycad fronds and ancient amber-bearing trees sweeping across the border.',
        negativeSpacePreference: 'Upper third is an open prehistoric mountain sky with gentle floating clouds, perfect for typography.',
        allowedMotifs: ['friendly baby herbivores', 'giant emerald ferns', 'fossil amber gems', 'gentle waterfalls', 'tropical blooms'],
        forbiddenMotifs: ['sharp teeth', 'carnivores hunting', 'meteor strikes', 'volcanic eruptions', 'frightened characters'],
        compatibleArchetypes: ['HERO_SCENE', 'STORY_MOMENT', 'FRAMED_WORLD', 'MAGICAL_NEGATIVE_SPACE']
    },

    'ocean-and-dolphins': {
        themeKey: 'ocean-and-dolphins',
        themeName: 'Ocean & Dolphins',
        visualNorthStar: 'A luminous, crystalline marine sanctuary of glowing coral reefs, iridescent sea pearls, and joyful leaping dolphins.',
        coverMood: 'Serene, magical, flowing, playful, gentle ocean mystery.',
        palette: {
            primary: '#0077b6',
            accent: '#90e0ef',
            accentAlt: '#ffd166',
            background: '#023e8a',
            text: '#ffffff',
            scrim: 'rgba(2, 62, 138, 0.75)'
        },
        childRole: 'A joyful sea dreamer in an aquatic-tinted adventurer outfit or sea-pearl tunic, smiling warmly.',
        heroAction: 'swimming or floating weightlessly beside a gentle glowing dolphin, touching its fin with gentle wonder.',
        heroFocalArea: 'occupies 60% to 65% of the composition in harmonious dance with the dolphin.',
        lighting: 'Aquatic caustics dancing on skin and clothes, iridescent bioluminescent glow from reef corals.',
        texture: 'Translucent watercolor washes combined with rich digital oils, shimmering water reflections.',
        environmentalFraming: 'Curving gentle waves, kelp ribbons, and glowing sea-glass pearls framing the lower perimeter.',
        negativeSpacePreference: 'Upper section opens to calm turquoise ocean surface and soft sunlit sky for clean typography.',
        allowedMotifs: ['playful dolphins', 'sea turtles', 'luminous coral', 'shimmering bubbles', 'iridescent seashells'],
        forbiddenMotifs: ['sharks', 'stormy dark waters', 'shipwrecks', 'deep sea trenches', 'monsters'],
        compatibleArchetypes: ['HERO_SCENE', 'STORY_MOMENT', 'THEME_SIGNATURE', 'MAGICAL_NEGATIVE_SPACE']
    },

    'fairies-and-magic': {
        themeKey: 'fairies-and-magic',
        themeName: 'Fairies & Magic Garden',
        visualNorthStar: 'A hidden twilight enchanted garden illuminated by hundreds of floating blossom lanterns, dew drops, and sparkling fairy wings.',
        coverMood: 'Whimsical, enchanting, delicate, wonder-struck, dreamy.',
        palette: {
            primary: '#4a154b',
            accent: '#f9bec7',
            accentAlt: '#ffd166',
            background: '#2b0930',
            text: '#ffffff',
            scrim: 'rgba(43, 9, 48, 0.75)'
        },
        childRole: 'A cherished garden guest or fairy companion with delicate glowing gossamer wings and a petal-woven flower crown.',
        heroAction: 'holding open a tiny glowing acorn lantern as tiny friendly pixies and fireflies dance around their happy smile.',
        heroFocalArea: 'centers the child as the glowing focal hero commanding 60% to 65% of the canvas.',
        lighting: 'Bioluminescent pastel glows, soft magenta and amber rim light, magical sparkling embers.',
        texture: 'Fine storybook artisan gouache, soft velvet flower petals, crystalline wing translucency.',
        environmentalFraming: 'Twining morning glory vines and giant glowing foxglove bells softly framing the edges.',
        negativeSpacePreference: 'Upper third is a soft, uncluttered purple twilight atmosphere reserved for elegant title typography.',
        allowedMotifs: ['blossom lanterns', 'tiny fairy dust sparkles', 'butterfly wings', 'morning glory vines', 'flower crowns'],
        forbiddenMotifs: ['dark witches', 'poisonous toadstools', 'creepy crawlers', 'dead gardens', 'spooky webs'],
        compatibleArchetypes: ['EDITORIAL_PORTRAIT', 'HERO_SCENE', 'FRAMED_WORLD', 'MAGICAL_NEGATIVE_SPACE']
    },

    'trains-and-vehicles': {
        themeKey: 'trains-and-vehicles',
        themeName: 'Trains & Tracks',
        visualNorthStar: 'A whimsical storybook railway winding through rolling starlit valleys, with a polished emerald and brass storybook locomotive.',
        coverMood: 'Cozy, nostalgic, adventurous, cheerful rhythm, comforting journey.',
        palette: {
            primary: '#1f3160',
            accent: '#e0a96d',
            accentAlt: '#c0392b',
            background: '#0d1830',
            text: '#ffffff',
            scrim: 'rgba(13, 24, 48, 0.75)'
        },
        childRole: 'A proud little junior train conductor in an adorable conductor cap, brass-buttoned coat, and pocket watch.',
        heroAction: 'waving happily from the front platform of the storybook steam train as it chugs softly under a starry night sky.',
        heroFocalArea: 'prominently positions the child and the charming locomotive across 60% to 65% of the composition.',
        lighting: 'Warm golden glow from train lanterns and cabin windows casting cheerful amber pools onto the child.',
        texture: 'Polished artisan brass, soft billowy steam clouds rendered in digital gouache, warm velvet coat.',
        environmentalFraming: 'Curving railway tracks and gentle rolling hills framing the hero from below.',
        negativeSpacePreference: 'Upper third features tranquil twilight sky with soft crescent moon, providing clear title area.',
        allowedMotifs: ['brass steam engines', 'conductor lanterns', 'twinkling railway signals', 'winding tracks', 'puffy steam puffs'],
        forbiddenMotifs: ['train crashes', 'industrial smoke smog', 'dark tunnels', 'derailments', 'dangerous machinery'],
        compatibleArchetypes: ['HERO_SCENE', 'STORY_MOMENT', 'THEME_SIGNATURE', 'EDITORIAL_PORTRAIT']
    },

    'bedtime-lullabies': {
        themeKey: 'bedtime-lullabies',
        themeName: 'Bedtime Lullabies',
        visualNorthStar: 'A dreamy, cloud-spun bedtime haven where fluffy sheep graze on floating star pastures and crescent moon boats cradle gentle dreams.',
        coverMood: 'Deeply comforting, soothing, peaceful, sleepy warmth, tender love.',
        palette: {
            primary: '#14213d',
            accent: '#fca311',
            accentAlt: '#e5e5e5',
            background: '#0b132b',
            text: '#ffffff',
            scrim: 'rgba(11, 19, 43, 0.75)'
        },
        childRole: 'A cozy little dreamer in soft pastel star pajamas or cozy nightgown, holding a favorite soft plushie.',
        heroAction: 'sitting gently in the curve of a giant slumbering crescent moon, listening to a sweet lullaby, smiling sleepily.',
        heroFocalArea: 'takes up 60% to 65% of the cover, cocooned in soft moonlight and pillowy clouds.',
        lighting: 'Soft silver moonlight combined with warm golden starlight, gentle diffuse bedtime glow.',
        texture: 'Fluffy cloud gouache, soft fleece blanket textures, gentle atmospheric haze, painterly lullaby realism.',
        environmentalFraming: 'Billowing soft pastel clouds sweeping upward around the lower and side borders.',
        negativeSpacePreference: 'Upper section is a wide, peaceful midnight velvet sky perfect for gentle, elegant typography.',
        allowedMotifs: ['slumbering crescent moon', 'woolly sheep', 'cloud pillows', 'twinkling bedtime stars', 'soft plushies'],
        forbiddenMotifs: ['nightmares', 'monsters under bed', 'stormy lightning', 'loud clocks', 'dark shadows'],
        compatibleArchetypes: ['EDITORIAL_PORTRAIT', 'MAGICAL_NEGATIVE_SPACE', 'HERO_SCENE', 'THEME_SIGNATURE']
    },

    'circus-and-carnival': {
        themeKey: 'circus-and-carnival',
        themeName: 'Circus & Carnivals',
        visualNorthStar: 'A magical storybook vintage carnival with illuminated carousel horses, glowing paper lanterns, and festive joy under the stars.',
        coverMood: 'Festive, joyful, sparkling, wondrous, delightful celebration.',
        palette: {
            primary: '#6b1724',
            accent: '#ffd166',
            accentAlt: '#06d6a0',
            background: '#3d0a13',
            text: '#ffffff',
            scrim: 'rgba(61, 10, 19, 0.75)'
        },
        childRole: 'A joyous ringmaster or festival hero in an elegant velvet festival coat with gold frogging and a joyful top hat.',
        heroAction: 'riding a radiant golden carousel horse with mane of ribbons, laughing happily with hands up in the air.',
        heroFocalArea: 'occupies 60% to 65% of the frame with joyful movement and vibrant character presence.',
        lighting: 'Warm festive festival bulb strings, carousel mirrors reflecting golden fairy lights onto the child.',
        texture: 'Rich painterly oils, gilded carousel gold leaf, crisp fabric and festive bunting texture.',
        environmentalFraming: 'Festive pennant banners and strings of glowing globes framing the top and sides.',
        negativeSpacePreference: 'Upper third is calm festive night sky above the carnival tents, reserved for typography.',
        allowedMotifs: ['carousel horses', 'glowing balloons', 'festive star ribbons', 'circus tent spires', 'confetti sparkles'],
        forbiddenMotifs: ['creepy clowns', 'caged wild animals', 'fire accidents', 'broken rides', 'dark eerie alleyways'],
        compatibleArchetypes: ['HERO_SCENE', 'STORY_MOMENT', 'THEME_SIGNATURE', 'EDITORIAL_PORTRAIT']
    },

    'unicorns-and-rainbows': {
        themeKey: 'unicorns-and-rainbows',
        themeName: 'Unicorns & Rainbows',
        visualNorthStar: 'A crystal valley arched by luminous pastel rainbows, where gentle golden-horned unicorns walk on clouds.',
        coverMood: 'Magical, uplifting, innocent, sparkling, pure enchantment.',
        palette: {
            primary: '#522b5b',
            accent: '#ffb4a2',
            accentAlt: '#e5989b',
            background: '#2b1233',
            text: '#ffffff',
            scrim: 'rgba(43, 18, 51, 0.75)'
        },
        childRole: 'A radiant little dreamer in a pastel rainbow-trimmed cloak, gentle and kind.',
        heroAction: 'gently hugging the neck of a magnificent, gentle unicorn with flowing pearlescent mane, both smiling warmly.',
        heroFocalArea: 'centers the child and unicorn together across 60% to 65% of the cover in heartfelt connection.',
        lighting: 'Prismatic rainbow refraction, pearlescent glow, soft warm sunlight filtering through magical mist.',
        texture: 'Silky hair rendering, soft cloud textures, shimmering gemstone highlights, fine gouache artistry.',
        environmentalFraming: 'Sweeping arch of a translucent pastel rainbow curving gracefully over the scene.',
        negativeSpacePreference: 'Upper section is a soft pastel lavender-blue sky with serene open space for title typography.',
        allowedMotifs: ['gentle unicorn', 'pastel rainbow arch', 'crystal gems', 'star blossoms', 'soft cloud meadows'],
        forbiddenMotifs: ['sharp horns as weapons', 'dark curses', 'monsters', 'gloomy storms', 'bleak landscapes'],
        compatibleArchetypes: ['HERO_SCENE', 'EDITORIAL_PORTRAIT', 'STORY_MOMENT', 'FRAMED_WORLD']
    },

    'safari-and-jungle': {
        themeKey: 'safari-and-jungle',
        themeName: 'Jungle Safari',
        visualNorthStar: 'A vibrant African golden savannah and emerald rainforest border where friendly baby elephants and giraffes roam under acacia trees.',
        coverMood: 'Warm, sunny, expansive, lively, curious, thrilling adventure.',
        palette: {
            primary: '#2d3e1e',
            accent: '#e9c46a',
            accentAlt: '#e76f51',
            background: '#16200d',
            text: '#ffffff',
            scrim: 'rgba(22, 32, 13, 0.75)'
        },
        childRole: 'An intrepid little wildlife explorer in a sun-hat, khaki exploration shorts, and a small brass magnifying glass.',
        heroAction: 'standing happily beside a playful baby elephant holding a wildflower with its trunk, gazing out across the golden plains.',
        heroFocalArea: 'dominates 60% to 65% of the composition with warm, inviting presence and wildlife friendship.',
        lighting: 'Rich volumetric golden hour sun rays, radiant African sunset glow on the horizon.',
        texture: 'Rich painterly impasto textures, warm grassland brushwork, textured elephant skin and explorer fabrics.',
        environmentalFraming: 'Golden acacia boughs and broad emerald palm leaves gently arching along the edges.',
        negativeSpacePreference: 'Upper third is a warm, uncluttered golden sunset sky tailored for bold, readable title typography.',
        allowedMotifs: ['baby elephants', 'friendly giraffes', 'golden acacia trees', 'sunflower sunbeams', 'colorful birds'],
        forbiddenMotifs: ['predators attacking', 'poachers', 'cages', 'scary snakes', 'harsh arid deserts'],
        compatibleArchetypes: ['HERO_SCENE', 'STORY_MOMENT', 'EDITORIAL_PORTRAIT', 'MAGICAL_NEGATIVE_SPACE']
    }
};

/**
 * Normalizes user/book theme string to matching Theme Master Constitution
 */
function getThemeMaster(themeStr) {
    const s = String(themeStr || '').toLowerCase().trim();
    if (s.includes('space') || s.includes('star') || s.includes('cosmic')) return THEME_MASTERS['space-and-stars'];
    if (s.includes('forest') || s.includes('animal') || s.includes('woodland')) return THEME_MASTERS['forest-and-animals'];
    if (s.includes('princess') || s.includes('castle') || s.includes('kingdom') || s.includes('royal')) return THEME_MASTERS['kingdom-and-princess'];
    if (s.includes('super') || s.includes('hero')) return THEME_MASTERS['superhero-stories'];
    if (s.includes('dinosaur') || s.includes('dino') || s.includes('prehistoric')) return THEME_MASTERS['dinosaur-wonders'];
    if (s.includes('ocean') || s.includes('dolphin') || s.includes('sea') || s.includes('mermaid')) return THEME_MASTERS['ocean-and-dolphins'];
    if (s.includes('fairy') || s.includes('magic') || s.includes('pixie')) return THEME_MASTERS['fairies-and-magic'];
    if (s.includes('train') || s.includes('track') || s.includes('vehicle')) return THEME_MASTERS['trains-and-vehicles'];
    if (s.includes('lullaby') || s.includes('bedtime') || s.includes('sleep')) return THEME_MASTERS['bedtime-lullabies'];
    if (s.includes('circus') || s.includes('carnival') || s.includes('carousel')) return THEME_MASTERS['circus-and-carnival'];
    if (s.includes('unicorn') || s.includes('rainbow')) return THEME_MASTERS['unicorns-and-rainbows'];
    if (s.includes('safari') || s.includes('jungle') || s.includes('savannah')) return THEME_MASTERS['safari-and-jungle'];

    // Default fallback to Space & Stars
    return THEME_MASTERS['space-and-stars'];
}

module.exports = {
    THEME_MASTERS,
    getThemeMaster
};
