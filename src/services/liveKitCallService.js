import { callFunctionHttp } from './firebaseFunctionHttp';

export async function fetchLiveKitCallToken({ callId, displayName } = {}) {
  if (!callId) {
    throw new Error('Call ID is required before joining a LiveKit room.');
  }

  const result = await callFunctionHttp('sideEffectGuidanceChatHttp', {
    __operation: 'createLiveKitCallToken',
    callId,
    displayName,
  });

  if (!result?.livekitUrl || !result?.token || !result?.roomName) {
    throw new Error('LiveKit call token response was incomplete.');
  }

  return result;
}
