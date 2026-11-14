export const extendEndsAtLua = `
local function extendEndsAt(now, endsAt, originalEndsAt, windowMs, extensionMs, maxExtensionMs)
  if endsAt - now >= windowMs then
    return endsAt, false
  end

  local proposed = now + extensionMs
  local cap = originalEndsAt + maxExtensionMs
  if proposed > cap then
    proposed = cap
  end

  if proposed <= endsAt then
    return endsAt, false
  end

  return proposed, true
end
`;
