const toolCollections = {
    leader_only_tools : [
        'consult_member'
    ],

    all_access_tools: [
        'show_all_tools',
        'view_team_members'
    ],

    chat_tools: [
        'view_chatroom',
        'send_chat_message'
    ],

    input_tools : [
        'list_data_structures',
        'get_structure_info',

        'get_array_length',
        'sample_array_items',

        'get_object_property',
        'check_set_contains',
        'get_map_value'
    ],

    notes_tools : [
        'create_note',
        'delete_note',
        'list_my_notes',
        'get_my_note'
    ],

    system_tools : [
        'get_current_datetime'
    ],

    code_tools : [
        'run_js_code'
    ]
};

export const leaderToolbelt = [
    toolCollections.leader_only_tools,
    toolCollections.all_access_tools,
    toolCollections.chat_tools,
    toolCollections.notes_tools,
    toolCollections.system_tools
];

export const demoWorkerToolbelt = [
    toolCollections.all_access_tools,
    toolCollections.chat_tools,
    toolCollections.input_tools,
    toolCollections.notes_tools,
    toolCollections.system_tools,
    toolCollections.code_tools
];