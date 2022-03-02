import * as t from "io-ts";
import { mustDecode, StringList, withDefault } from "./utils";

const ConfigDecoder = t.exact(
  t.type({
    components: withDefault(
      t.record(
        t.string,
        t.type({
          reviewers: withDefault(StringList, []),
          approvers: withDefault(StringList, []),
        })
      ),
      {}
    ),
    "ignored-authors": withDefault(StringList, []),
  })
);

export type Owners = {
  reviewers: string[];
  approvers: string[];
};

export type Config = {
  components: Record<string, Owners>;
  ignoredAuthors: Set<string>;
};

export function validateConfig(conf: unknown): Config {
  const decoded = mustDecode(ConfigDecoder, conf);
  return {
    components: decoded.components,
    ignoredAuthors: new Set(decoded["ignored-authors"]),
  };
}
