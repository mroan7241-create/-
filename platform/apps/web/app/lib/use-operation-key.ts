"use client";
import { useRef } from "react";
import { newOpId } from "./api";
/** Reuse the operation key after an uncertain response; changed input is a new intent. */
export function useOperationKey() {
  const operations = useRef(new Map<string, string>());
  return (payload: unknown) => {
    const fingerprint = JSON.stringify(payload);
    let key = operations.current.get(fingerprint);
    if (!key) {
      key = newOpId();
      operations.current.set(fingerprint, key);
    }
    return key;
  };
}
