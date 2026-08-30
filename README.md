# Athletic Standard

A file on your computer that holds your training and recovery data.

Numbers from a watch or wearable (sleep, heart rate, workout times) are stored separately from things you report yourself (soreness, mood). That way it’s always clear which is which.

Not an app. Not a coach. Not medical advice.

## Start

You need [Node.js](https://nodejs.org) 20 or later.

Open a terminal in an empty folder and run:

```
npx athleticstandard init
```

Answer the questions (or skip them). You’ll get a file called `athlete.ath.json`.

## Look at it

```
npx athleticstandard check
npx athleticstandard stats
```

`check` makes sure the file is valid. `stats` prints a short summary. You can also open `athlete.ath.json` in any text editor.

## Load data from a watch

Not ready yet. When it is, you export from Apple Health, WHOOP, or Oura and load that file. The export already has the data you need.

## More

The field-by-field format is in [SPEC.md](SPEC.md).
