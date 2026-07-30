/**
 * Typed shapes for SMSC JSON (`fmt=3`) responses.
 * Fields are optional — SMSC docs are uneven across HLR/Ping/status/callback.
 * Always preserve full raw payload alongside these parses.
 */

export type SmscErrorBody = {
  error?: string;
  error_code?: number | string;
  id?: number | string;
};

export type SmscSendSuccessBody = {
  id?: number | string;
  cnt?: number | string;
  cost?: string | number;
  balance?: string | number;
};

export type SmscCostBody = {
  cost?: string | number;
  cnt?: number | string;
  error?: string;
  error_code?: number | string;
};

export type SmscBalanceBody = {
  balance?: string | number;
  error?: string;
  error_code?: number | string;
};

/**
 * status.php with all>=1 / callback status payload.
 * HLR extras: imsi, msc, mcc, mnc, cn, net, rcn, rnet;
 * all=2 also: country, operator, region.
 */
export type SmscStatusBody = {
  id?: number | string;
  phone?: string | number;
  status?: number | string;
  err?: number | string;
  last_date?: string;
  last_timestamp?: number | string;
  send_date?: string;
  send_timestamp?: number | string;
  message?: string;
  type?: number | string;
  cost?: string | number;
  sender?: string;
  /** HLR */
  imsi?: string | number;
  msc?: string | number;
  mcc?: string | number;
  mnc?: string | number;
  cn?: string;
  net?: string;
  rcn?: string;
  rnet?: string;
  /** Extended status (all=2): number registration geo */
  country?: string;
  operator?: string;
  region?: string;
  /** Present on some extended responses */
  flag?: number | string;
  error?: string;
  error_code?: number | string;
};

export type SmscCallbackPayload = SmscStatusBody & {
  md5?: string;
  sha1?: string;
  crc32?: string | number;
  ts?: number | string;
  time?: string;
  syserr?: number | string;
  cnt?: number | string;
};

export type SmscHttpResult<T = unknown> = {
  ok: boolean;
  httpStatus: number;
  body: T;
  /** Duration of the successful attempt (after retries). */
  durationMs: number;
  attempts: number;
  urlPath: string;
};
