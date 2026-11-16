// Join links for classes: /join/K7Q2PMXA (or /join/K7Q2-PMXA/). The page itself is /join/, which
// reads the code from the address; the Worker answers these links with it.
export const isJoinLink = (path: string): boolean => /^\/join\/[A-Za-z0-9-]{1,20}\/?$/.test(path);
