include_guard(GLOBAL)

# QSession pins the official LiveKit C++ SDK so every release uses the same
# protocol and media implementation. The archive hash prevents a replaced or
# incomplete download from entering a production build.
set(QSESSION_LIVEKIT_VERSION "1.5.0")
set(QSESSION_LIVEKIT_SHA256 "FF5C6D1F5A96BF0DF11208AA1B5ACABB50E65F4D28E41D67521E2A67DC3E0F04")

function(qsession_livekit_sdk_setup)
    if(NOT WIN32 OR NOT CMAKE_SIZEOF_VOID_P EQUAL 8)
        message(FATAL_ERROR "QSession LiveKit currently supports Windows x64 only")
    endif()

    set(_archive_name "livekit-sdk-windows-x64-${QSESSION_LIVEKIT_VERSION}.zip")
    set(_download_dir "${CMAKE_CURRENT_SOURCE_DIR}/.deps")
    set(_archive "${_download_dir}/${_archive_name}")
    set(_sdk_parent "${_download_dir}/livekit-sdk")
    set(_sdk_root "${_sdk_parent}/livekit-sdk-windows-x64-${QSESSION_LIVEKIT_VERSION}")
    set(_url "https://github.com/livekit/client-sdk-cpp/releases/download/v${QSESSION_LIVEKIT_VERSION}/${_archive_name}")

    file(MAKE_DIRECTORY "${_download_dir}" "${_sdk_parent}")
    if(NOT EXISTS "${_archive}")
        message(STATUS "Downloading pinned LiveKit C++ SDK ${QSESSION_LIVEKIT_VERSION}")
        file(DOWNLOAD "${_url}" "${_archive}"
            TLS_VERIFY ON
            SHOW_PROGRESS
            EXPECTED_HASH "SHA256=${QSESSION_LIVEKIT_SHA256}"
            STATUS _download_status)
        list(GET _download_status 0 _download_code)
        list(GET _download_status 1 _download_message)
        if(NOT _download_code EQUAL 0)
            file(REMOVE "${_archive}")
            message(FATAL_ERROR "LiveKit download failed: ${_download_message}")
        endif()
    else()
        file(SHA256 "${_archive}" _existing_hash)
        string(TOUPPER "${_existing_hash}" _existing_hash)
        if(NOT _existing_hash STREQUAL QSESSION_LIVEKIT_SHA256)
            message(FATAL_ERROR "The cached LiveKit archive has an invalid SHA256 hash")
        endif()
    endif()

    if(NOT EXISTS "${_sdk_root}/lib/cmake/LiveKit/LiveKitConfig.cmake")
        file(ARCHIVE_EXTRACT INPUT "${_archive}" DESTINATION "${_sdk_parent}")
    endif()

    set(LiveKit_DIR "${_sdk_root}/lib/cmake/LiveKit" PARENT_SCOPE)
    set(QSESSION_LIVEKIT_ROOT "${_sdk_root}" PARENT_SCOPE)
endfunction()
