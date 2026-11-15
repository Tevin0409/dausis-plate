// Slice 2.6, Reset password: "Make one for me" fills a readable temporary password, like mango-4729.
/**
 * About 250 short food and everyday words, lowercase a–z. With 4 digits that is about 21 bits, the same
 * shape as mango-4729. No two words are one letter apart (pear/peer, mug/jug), so one read out over the
 * phone is not mistaken for another; tests/unit/temp-password.test.ts checks it.
 */
export const TEMP_WORDS = [
  "mango", "pilau", "chapati", "ugali", "sukuma", "githeri", "mandazi", "samosa", "pawpaw", "tamarind",
  "cassava", "coconut", "ndengu", "matoke", "mukimo", "nyama", "chai", "passion", "avocado", "biryani",
  "apple", "banana", "lemon", "lime", "orange", "peach", "plum", "grape", "melon", "cherry", "berry",
  "guava", "kiwi", "papaya", "pumpkin", "carrot", "onion", "garlic", "ginger", "pepper", "tomato", "potato",
  "cabbage", "spinach", "kale", "lettuce", "celery", "radish", "turnip", "beetroot", "maize", "millet",
  "sorghum", "barley", "wheat", "oats", "rice", "beans", "lentil", "peas", "cashew", "almond", "peanut",
  "walnut", "honey", "sugar", "salt", "butter", "cheese", "yogurt", "cream", "milk", "bread", "toast",
  "muffin", "cookie", "biscuit", "pancake", "waffle", "donut", "scone", "bagel", "noodle", "pasta", "pizza",
  "burger", "sausage", "bacon", "chicken", "turkey", "beef", "mutton", "goat", "fish", "tilapia", "prawn",
  "crab", "squid", "salmon", "tuna", "sardine", "omena", "pilipili", "masala", "curry", "stew", "soup",
  "broth", "gravy", "sauce", "relish", "pickle", "jam", "jelly", "fudge", "candy", "cocoa", "coffee", "tea",
  "juice", "soda", "water", "lemonade", "smoothie", "table", "spoon", "fork", "knife", "plate", "bowl",
  "cup", "mug", "kettle", "teapot", "pan", "pot", "oven", "stove", "grill", "basket", "tray", "napkin",
  "apron", "candle", "lamp", "window", "door", "garden", "fence", "gate", "pillow", "blanket", "carpet",
  "curtain", "mirror", "clock", "radio", "phone", "pencil", "paper", "book", "letter", "stamp", "ticket",
  "wallet", "ribbon", "thread", "needle", "bucket", "ladder", "hammer", "shovel", "rake", "hose", "river",
  "ocean", "island", "valley", "meadow", "forest", "hill", "desert", "canyon", "cloud", "rain", "sunny",
  "breeze", "thunder", "rainbow", "sunset", "sunrise", "winter", "summer", "autumn", "spring", "morning",
  "evening", "tiger", "zebra", "giraffe", "hippo", "rhino", "monkey", "eagle", "falcon", "robin", "sparrow",
  "pigeon", "rabbit", "turtle", "dolphin", "whale", "panda", "koala", "camel", "pony", "puppy", "kitten",
  "lion", "red", "blue", "green", "yellow", "purple", "pink", "silver", "golden", "violet", "amber", "coral",
  "ruby", "jade", "drum", "guitar", "piano", "violin", "flute", "trumpet", "banjo", "happy", "lucky", "cozy",
  "brave", "calm", "gentle", "kind", "proud", "quiet", "swift", "bold", "bright"
] as const;

const rand = (n: number) => {
  const a = new Uint32Array(1);
  crypto.getRandomValues(a);
  return a[0]! % n;
};

export function makeTempPassword(): string {
  return `${TEMP_WORDS[rand(TEMP_WORDS.length)]}-${String(rand(10000)).padStart(4, "0")}`;
}

/** A typed temporary password: at least 8 characters, as the spec's password rule. */
export const isTempPassword = (p: string) => p.length >= 8;
