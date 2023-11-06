# lighthouse-ci

This is a Lighthouse CI script generated and revised multiple times by ChatGPT 4. I have tested its functionality, and it works properly.

## Feature

1. It generates results for mobile and desktop separately, timestamped.
2. After each run, it compares the scores with the previous ones and saves the results.

## Usage

Create a `urls.json` file, for example:

```json
{
  "us": ["https://example.com"],
  "ca": ["https://ca.example.com"]
}
```

To run:

```shell
node main.mjs
```

This will only run the `us` site.

```shell
node main.mjs --us
```
