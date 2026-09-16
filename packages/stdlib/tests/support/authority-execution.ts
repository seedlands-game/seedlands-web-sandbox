import { createKernelStateOwner } from '@seedlands/kernel/execution';
import {
  createAuthorityKernelExecutionPort,
  createAuthorityKernelState,
} from '../../src/server/authority/authority-kernel-state';

/** Explicit owner for isolated scheduler tests whose server port is an in-memory stub. */
export const createTestAuthorityExecution = () =>
  createAuthorityKernelExecutionPort(createKernelStateOwner(), createAuthorityKernelState());
