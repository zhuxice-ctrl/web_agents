if (-not ("WebAgents.NativeProcessApi" -as [type])) {
  Add-Type -TypeDefinition @'
using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.Runtime.InteropServices;
using System.Text;

namespace WebAgents
{
    public sealed class NativeProcessInfo
    {
        public int ProcessId { get; set; }
        public int ParentProcessId { get; set; }
        public string Name { get; set; }
        public string CommandLine { get; set; }
        public long CreationUtcTicks { get; set; }
    }

    public static class NativeProcessApi
    {
        private const uint ProcessQueryLimitedInformation = 0x1000;
        private const int ProcessBasicInformation = 0;
        private const int ProcessCommandLineInformation = 60;
        private const int AddressFamilyInet = 2;
        private const int TcpTableOwnerPidListener = 3;
        private const uint ErrorInsufficientBuffer = 122;

        [StructLayout(LayoutKind.Sequential)]
        private struct ProcessBasicInfo
        {
            public IntPtr Reserved1;
            public IntPtr PebBaseAddress;
            public IntPtr Reserved2_0;
            public IntPtr Reserved2_1;
            public IntPtr UniqueProcessId;
            public IntPtr InheritedFromUniqueProcessId;
        }

        [StructLayout(LayoutKind.Sequential)]
        private struct UnicodeString
        {
            public ushort Length;
            public ushort MaximumLength;
            public IntPtr Buffer;
        }

        [StructLayout(LayoutKind.Sequential)]
        private struct FileTime
        {
            public uint LowDateTime;
            public uint HighDateTime;
        }

        [StructLayout(LayoutKind.Sequential)]
        private struct TcpRowOwnerPid
        {
            public uint State;
            public uint LocalAddress;
            public uint LocalPort;
            public uint RemoteAddress;
            public uint RemotePort;
            public uint OwningProcessId;
        }

        [DllImport("kernel32.dll", SetLastError = true)]
        private static extern IntPtr OpenProcess(uint desiredAccess, bool inheritHandle, int processId);

        [DllImport("kernel32.dll", SetLastError = true)]
        private static extern bool CloseHandle(IntPtr handle);

        [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
        private static extern bool QueryFullProcessImageName(
            IntPtr process,
            int flags,
            StringBuilder executableName,
            ref int size);

        [DllImport("kernel32.dll", SetLastError = true)]
        private static extern bool GetProcessTimes(
            IntPtr process,
            out FileTime creationTime,
            out FileTime exitTime,
            out FileTime kernelTime,
            out FileTime userTime);

        [DllImport("ntdll.dll")]
        private static extern int NtQueryInformationProcess(
            IntPtr process,
            int informationClass,
            IntPtr information,
            int informationLength,
            out int returnLength);

        [DllImport("iphlpapi.dll", SetLastError = true)]
        private static extern uint GetExtendedTcpTable(
            IntPtr tcpTable,
            ref int outputBufferLength,
            bool order,
            int addressFamily,
            int tableClass,
            uint reserved);

        public static NativeProcessInfo Get(int processId)
        {
            return Get(processId, true);
        }

        private static NativeProcessInfo Get(int processId, bool includeCommandLine)
        {
            if (processId <= 0)
            {
                return null;
            }

            IntPtr handle = OpenProcess(ProcessQueryLimitedInformation, false, processId);
            if (handle == IntPtr.Zero)
            {
                return null;
            }

            try
            {
                ProcessBasicInfo basicInfo;
                if (!TryGetBasicInfo(handle, out basicInfo))
                {
                    return null;
                }

                return new NativeProcessInfo
                {
                    ProcessId = processId,
                    ParentProcessId = basicInfo.InheritedFromUniqueProcessId.ToInt32(),
                    Name = GetProcessName(handle, processId),
                    CommandLine = includeCommandLine ? GetCommandLine(handle) : null,
                    CreationUtcTicks = GetCreationUtcTicks(handle)
                };
            }
            finally
            {
                CloseHandle(handle);
            }
        }

        public static NativeProcessInfo[] Snapshot()
        {
            List<NativeProcessInfo> snapshot = new List<NativeProcessInfo>();
            Process[] processes = Process.GetProcesses();
            foreach (Process process in processes)
            {
                try
                {
                    NativeProcessInfo info = Get(process.Id, false);
                    if (info != null)
                    {
                        snapshot.Add(info);
                    }
                }
                catch
                {
                }
                finally
                {
                    process.Dispose();
                }
            }
            return snapshot.ToArray();
        }

        public static int[] GetTcpListenerOwnerIds(int port)
        {
            if (port < 1 || port > 65535)
            {
                return new int[0];
            }

            int bufferLength = 0;
            uint result = GetExtendedTcpTable(
                IntPtr.Zero,
                ref bufferLength,
                false,
                AddressFamilyInet,
                TcpTableOwnerPidListener,
                0);
            if (result != ErrorInsufficientBuffer && result != 0)
            {
                return new int[0];
            }
            if (bufferLength <= sizeof(uint))
            {
                return new int[0];
            }

            IntPtr buffer = Marshal.AllocHGlobal(bufferLength);
            try
            {
                result = GetExtendedTcpTable(
                    buffer,
                    ref bufferLength,
                    false,
                    AddressFamilyInet,
                    TcpTableOwnerPidListener,
                    0);
                if (result != 0)
                {
                    return new int[0];
                }

                int rowCount = Marshal.ReadInt32(buffer);
                int rowSize = Marshal.SizeOf(typeof(TcpRowOwnerPid));
                IntPtr rowPointer = IntPtr.Add(buffer, sizeof(uint));
                HashSet<int> owners = new HashSet<int>();
                for (int index = 0; index < rowCount; index++)
                {
                    TcpRowOwnerPid row = (TcpRowOwnerPid)Marshal.PtrToStructure(
                        IntPtr.Add(rowPointer, index * rowSize),
                        typeof(TcpRowOwnerPid));
                    int localPort = (int)(((row.LocalPort & 0xff) << 8) | ((row.LocalPort & 0xff00) >> 8));
                    if (localPort == port && row.OwningProcessId > 0)
                    {
                        owners.Add((int)row.OwningProcessId);
                    }
                }

                List<int> sortedOwners = new List<int>(owners);
                sortedOwners.Sort();
                return sortedOwners.ToArray();
            }
            finally
            {
                Marshal.FreeHGlobal(buffer);
            }
        }

        private static bool TryGetBasicInfo(IntPtr handle, out ProcessBasicInfo info)
        {
            int length = Marshal.SizeOf(typeof(ProcessBasicInfo));
            IntPtr buffer = Marshal.AllocHGlobal(length);
            try
            {
                int returnedLength;
                int status = NtQueryInformationProcess(
                    handle,
                    ProcessBasicInformation,
                    buffer,
                    length,
                    out returnedLength);
                if (status != 0)
                {
                    info = new ProcessBasicInfo();
                    return false;
                }
                info = (ProcessBasicInfo)Marshal.PtrToStructure(buffer, typeof(ProcessBasicInfo));
                return true;
            }
            finally
            {
                Marshal.FreeHGlobal(buffer);
            }
        }

        private static string GetCommandLine(IntPtr handle)
        {
            int requiredLength;
            NtQueryInformationProcess(
                handle,
                ProcessCommandLineInformation,
                IntPtr.Zero,
                0,
                out requiredLength);
            if (requiredLength <= Marshal.SizeOf(typeof(UnicodeString)))
            {
                return null;
            }

            IntPtr buffer = Marshal.AllocHGlobal(requiredLength);
            try
            {
                int returnedLength;
                int status = NtQueryInformationProcess(
                    handle,
                    ProcessCommandLineInformation,
                    buffer,
                    requiredLength,
                    out returnedLength);
                if (status != 0)
                {
                    return null;
                }
                UnicodeString commandLine = (UnicodeString)Marshal.PtrToStructure(
                    buffer,
                    typeof(UnicodeString));
                if (commandLine.Buffer == IntPtr.Zero || commandLine.Length == 0)
                {
                    return string.Empty;
                }
                return Marshal.PtrToStringUni(commandLine.Buffer, commandLine.Length / 2);
            }
            finally
            {
                Marshal.FreeHGlobal(buffer);
            }
        }

        private static string GetProcessName(IntPtr handle, int processId)
        {
            int size = 32768;
            StringBuilder executableName = new StringBuilder(size);
            if (QueryFullProcessImageName(handle, 0, executableName, ref size))
            {
                return Path.GetFileName(executableName.ToString());
            }

            try
            {
                using (Process process = Process.GetProcessById(processId))
                {
                    return process.ProcessName + ".exe";
                }
            }
            catch
            {
                return null;
            }
        }

        private static long GetCreationUtcTicks(IntPtr handle)
        {
            FileTime creationTime;
            FileTime exitTime;
            FileTime kernelTime;
            FileTime userTime;
            if (!GetProcessTimes(handle, out creationTime, out exitTime, out kernelTime, out userTime))
            {
                return 0;
            }
            long fileTime = ((long)creationTime.HighDateTime << 32) | creationTime.LowDateTime;
            try
            {
                return DateTime.FromFileTimeUtc(fileTime).Ticks;
            }
            catch
            {
                return 0;
            }
        }
    }
}
'@
}

function Get-WebAgentsProcessInfo {
  param([int] $ProcessId)
  return [WebAgents.NativeProcessApi]::Get($ProcessId)
}

function Get-WebAgentsProcessSnapshot {
  return @([WebAgents.NativeProcessApi]::Snapshot())
}

function Get-WebAgentsTcpListenerOwnerIds {
  param(
    [ValidateRange(1, 65535)]
    [int] $Port
  )
  return @([WebAgents.NativeProcessApi]::GetTcpListenerOwnerIds($Port))
}
