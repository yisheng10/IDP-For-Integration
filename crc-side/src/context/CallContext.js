import React, { createContext, useContext } from 'react';

const CallContext = createContext({
  callStatus: 'idle',
  callType: 'audio',
  localStream: null,
  remoteStream: null,
  otherUserName: '',
  startCall: async () => {},
  answerCall: async () => {},
  endCall: async () => {},
});

export const useCall = () => useContext(CallContext);

export const CallProvider = ({ children }) => <CallContext.Provider value={useContextValue()}>{children}</CallContext.Provider>;

function useContextValue() {
  return {
    callStatus: 'idle',
    callType: 'audio',
    localStream: null,
    remoteStream: null,
    otherUserName: '',
    startCall: async () => {},
    answerCall: async () => {},
    endCall: async () => {},
  };
}
