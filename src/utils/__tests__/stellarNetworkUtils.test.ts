import { describe, it, expect } from 'vitest';
import {
  DEFAULT_STELLAR_NETWORK,
  UnsupportedStellarNetworkError,
  getExplorerUrl,
  getNetworkPassphrase,
  getSorobanRpcUrl,
  isStellarCheckerNetwork,
  resolveCheckerNetwork,
  resolveSorobanRpc,
  toCheckerNetwork,
  toWalletNetwork,
} from '../stellarNetworkUtils';
import type { VenalabsChecker } from '../../types';

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

describe('Stellar network: single source of truth', () => {
  const checker = (overrides: Partial<VenalabsChecker>): VenalabsChecker => ({
    id: 'checker-1',
    organizationId: 'org-1',
    name: { en: 'Checker' },
    type: 'LINKED',
    status: 'ACTIVE',
    createdOn: '',
    ...overrides,
  });

  it('maps the stellarNetwork prop values to checker networks and back', () => {
    expect(toCheckerNetwork('TESTNET')).toBe('STELLAR_TESTNET');
    expect(toCheckerNetwork('PUBLIC')).toBe('STELLAR_PUBLIC');
    expect(toWalletNetwork('STELLAR_TESTNET')).toBe('TESTNET');
    expect(toWalletNetwork('STELLAR_PUBLIC')).toBe('PUBLIC');
  });

  it('keeps TESTNET as the default network', () => {
    expect(DEFAULT_STELLAR_NETWORK).toBe('TESTNET');
  });

  it('recognises the two supported checker networks only', () => {
    expect(isStellarCheckerNetwork('STELLAR_TESTNET')).toBe(true);
    expect(isStellarCheckerNetwork('STELLAR_PUBLIC')).toBe(true);
    expect(isStellarCheckerNetwork('STELLAR_FUTURENET')).toBe(false);
    expect(isStellarCheckerNetwork('ARBITRUM')).toBe(false);
    expect(isStellarCheckerNetwork('')).toBe(false);
    expect(isStellarCheckerNetwork(undefined)).toBe(false);
  });

  it('returns the passphrase and explorer segment of each network', () => {
    expect(getNetworkPassphrase('STELLAR_TESTNET')).toBe('Test SDF Network ; September 2015');
    expect(getNetworkPassphrase('STELLAR_PUBLIC')).toBe(
      'Public Global Stellar Network ; September 2015'
    );
    expect(getExplorerUrl('STELLAR_TESTNET', 'abc')).toContain('/explorer/testnet/');
    expect(getExplorerUrl('STELLAR_PUBLIC', 'abc')).toContain('/explorer/public/');
  });

  it('throws an explicit error for an unknown network instead of falling back to testnet', () => {
    for (const unknown of ['STELLAR_FUTURENET', 'ARBITRUM', 'PUBLIC', '']) {
      expect(() => getNetworkPassphrase(unknown)).toThrow(UnsupportedStellarNetworkError);
      expect(() => getSorobanRpcUrl(unknown)).toThrow(/Unsupported Stellar network/);
      expect(() => resolveSorobanRpc(unknown)).toThrow(/Unsupported Stellar network/);
      expect(() => getExplorerUrl(unknown, 'abc')).toThrow(/Unsupported Stellar network/);
    }
  });

  it('takes the network of a checker from its configuration', () => {
    expect(
      resolveCheckerNetwork(checker({ linkedConfig: { network: 'STELLAR_PUBLIC' } }), 'TESTNET')
    ).toEqual({ supported: true, network: 'STELLAR_PUBLIC' });
    expect(
      resolveCheckerNetwork(
        checker({ type: 'BALANCE', balanceConfig: { network: 'STELLAR_TESTNET', tokenCode: 'X' } }),
        'PUBLIC'
      )
    ).toEqual({ supported: true, network: 'STELLAR_TESTNET' });
    expect(
      resolveCheckerNetwork(
        checker({ type: 'TRANSACTION', transactionConfig: { network: 'STELLAR_PUBLIC' } }),
        'TESTNET'
      )
    ).toEqual({ supported: true, network: 'STELLAR_PUBLIC' });
    expect(
      resolveCheckerNetwork(
        checker({ type: 'NFT_MINT', nftMintConfig: { network: 'STELLAR_PUBLIC' } }),
        'TESTNET'
      )
    ).toEqual({ supported: true, network: 'STELLAR_PUBLIC' });
  });

  it('falls back to the stellarNetwork prop when the checker has no network', () => {
    expect(resolveCheckerNetwork(checker({}), 'PUBLIC')).toEqual({
      supported: true,
      network: 'STELLAR_PUBLIC',
    });
    expect(resolveCheckerNetwork(checker({}), 'TESTNET')).toEqual({
      supported: true,
      network: 'STELLAR_TESTNET',
    });
    // No prop either: the documented default (TESTNET)
    expect(resolveCheckerNetwork(checker({}))).toEqual({
      supported: true,
      network: 'STELLAR_TESTNET',
    });
  });

  it('reports an unknown checker network instead of replacing it', () => {
    expect(
      resolveCheckerNetwork(checker({ linkedConfig: { network: 'HYPERLIQUID_MAINNET' } }), 'PUBLIC')
    ).toEqual({ supported: false, network: 'HYPERLIQUID_MAINNET' });
  });
});
