export const agentsConfig = {
    name : 'VANKOR',

    tools : [
        'run_js_code'
    ],

    maxIterations : 1000,

    model : 'qwen3.5',

    options : {
        temperature: 1,
        presence_penalty : 1.5,
        top_p: 0.95,
        top_k: 20,
        num_ctx : 16384
    }
}