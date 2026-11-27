import { describe, it, expect } from 'vitest';
import { getSorobanRpcUrl, resolveSorobanRpc } from '../stellarNetworkUtils';

describe('Soroban RPC endpoint resolution', () => {
  it('uses mainnet.sorobanrpc.com for STELLAR_PUBLIC', () => {
    expect(getSorobanRpcUrl('STELLAR_PUBLIC')).toBe('https://mainnet.sorobanrpc.com');
  });

  it('uses the SDF testnet RPC for STELLAR_TESTNET', () => {
    expect(getSorobanRpcUrl('STELLAR_TESTNET')).toBe('https://soroban-testnet.stellar.org');
  });

  it('does not allow plain HTTP for the default HTTPS endpoints', () => {
    expect(resolveSorobanRpc('STELLAR_PUBLIC')).toEqual({
      url: 'https://mainnet.sorobanrpc.com',
      allowHttp: false,
    });
    expect(resolveSorobanRpc('STELLAR_TESTNET')).toEqual({
      url: 'https://soroban-testnet.stellar.org',
      allowHttp: false,
    });
  });

  it('lets an override replace the default URL on both networks', () => {
    expect(resolveSorobanRpc('STELLAR_PUBLIC', 'https://rpc.example.com/soroban')).toEqual({
      url: 'https://rpc.example.com/soroban',
      allowHttp: false,
    });
    expect(resolveSorobanRpc('STELLAR_TESTNET', 'https://rpc.example.com/soroban')).toEqual({
      url: 'https://rpc.example.com/soroban',
      allowHttp: false,
    });
  });

  it('allows HTTP only when the override itself is an http:// URL (local development)', () => {
    expect(resolveSorobanRpc('STELLAR_TESTNET', 'http://localhost:8000/soroban/rpc')).toEqual({
      url: 'http://localhost:8000/soroban/rpc',
      allowHttp: true,
    });
  });

  it('ignores an empty override and rejects one that is not an http(s) URL', () => {
    expect(resolveSorobanRpc('STELLAR_PUBLIC', '  ').url).toBe('https://mainnet.sorobanrpc.com');
    expect(() => resolveSorobanRpc('STELLAR_PUBLIC', 'ftp://rpc.example.com')).toThrow(
      /sorobanRpcUrl/
    );
    expect(() => resolveSorobanRpc('STELLAR_PUBLIC', 'not a url')).toThrow(/sorobanRpcUrl/);
  });
});
